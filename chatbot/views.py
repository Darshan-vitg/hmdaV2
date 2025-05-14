import uuid
import json
import base64
import requests
from django.shortcuts import render
from django.views.decorators.csrf import csrf_exempt
from django.http import JsonResponse
from django.core.files.storage import default_storage
from concurrent.futures import ThreadPoolExecutor

# Replace with your deployed Lambda URL
LAMBDA_API_URL = 'https://wkwg5ojnse54vm2ylk6agt3ovq0jswdp.lambda-url.us-east-1.on.aws/'

def convert_to_float(value):
    """Try to convert a coordinate value to a float."""
    try:
        return float(value)
    except Exception:
        raise ValueError(f"Conversion failed for value: {value}")

@csrf_exempt
def index(request):
    return render(request, 'index.html')

@csrf_exempt
def handle_prompt(request):
    if request.method != 'POST':
        return JsonResponse({'error': 'Only POST method allowed'}, status=405)

    prompt_id       = request.POST.get('prompt_id') or str(uuid.uuid4())
    message         = request.POST.get('message')
    images          = request.FILES.getlist('image')
    image_provided  = bool(images)
    is_same_lake    = request.POST.get("is_same_lake") == "on"

    # Retrieve per‑prompt chat history
    chat_histories = request.session.get('chat_histories', {})
    chat_history   = chat_histories.get(prompt_id, [])

    # Base payload
    payload = {
        'prompt_id': prompt_id,
        'message': message,
        'chat_history': chat_history,
        'is_same_lake': is_same_lake
    }

    # If no images, send text‑only
    if not images:
        try:
            resp = requests.post(
                LAMBDA_API_URL,
                data=json.dumps(payload),
                headers={'Content-Type': 'application/json'}
            )
            response_data = resp.json()
        except Exception as e:
            return JsonResponse({'error': f'Error communicating with Lambda: {e}'})

        # Update session history
        if 'chat_history' in response_data:
            chat_histories[prompt_id] = response_data['chat_history']
            request.session['chat_histories'] = chat_histories
            request.session.modified = True

        return JsonResponse(response_data)

    # Otherwise, process each image concurrently
    def process_image(image_file):
        # Save & read
        temp_path = default_storage.save(image_file.name, image_file)
        with default_storage.open(temp_path, 'rb') as f:
            encoded = base64.b64encode(f.read()).decode()
        default_storage.delete(temp_path)

        # Build image payload
        img_payload = {
            'prompt_id': prompt_id,
            'chat_history': chat_history,
            'image': encoded
        }
        if message:
            img_payload['message'] = message

        try:
            lresp = requests.post(
                LAMBDA_API_URL,
                json=img_payload,
                timeout=120
            )
            lresp.raise_for_status()
            ct = lresp.headers.get('Content-Type', '')
            if 'application/json' not in ct:
                raise ValueError(f"Expected JSON but got {ct}: {lresp.text[:200]}")
            result = lresp.json()
            if isinstance(result, list):
                result = {'error': 'Unexpected response format: list instead of dict'}
        except Exception as e:
            result = {'error': f"Error processing {image_file.name}: {e}"}

        result['image_name'] = image_file.name
        return result

    results = list(ThreadPoolExecutor().map(process_image, images))
    #print(results)
    aggregated_valid    = []
    aggregated_invalid  = []
    aggregated_urls     = []
    combined_text       = ""

    for idx, res in enumerate(results):
        if res.get('error'):
            combined_text += f"Error processing {res['image_name']}: {res['error']}"
            continue

        valid_raw = res.get("valid_coordinates", [])
        lake_coords = []
        for coord in valid_raw:
            try:
                if isinstance(coord, (list, tuple)) and len(coord) >= 2:
                    lat, lon = convert_to_float(coord[0]), convert_to_float(coord[1])
                elif isinstance(coord, dict):
                    raw_lat = coord.get("lat", coord.get("latitude"))
                    raw_lon = coord.get("lon", coord.get("longitude"))
                    lat, lon = convert_to_float(raw_lat), convert_to_float(raw_lon)
                else:
                    raise ValueError
                cd = {"lat": lat, "lon": lon}
                if is_same_lake:
                    aggregated_valid.append(cd)
                else:
                    lake_coords.append(cd)
            except Exception:
                aggregated_invalid.append(coord)

        # collect any invalids returned
        aggregated_invalid.extend(res.get("invalid_coordinates", []))

        # wrap each lake separately if not merging
        if not is_same_lake and lake_coords:
            aggregated_valid.append({
                "lake_name": f"Lake {idx + 1}",
                "coordinates": lake_coords
            })

        # collect image URLs

        for key in ("image_urls", "image_url"):
            if key in res:
                urls = res[key] if isinstance(res[key], list) else [res[key]]
                for u in urls:
                    if isinstance(u, str) and u.strip():
                        aggregated_urls.append(u.strip())

        combined_text += res.get("response", "")

    if image_provided and not aggregated_valid:
        if aggregated_invalid:
            combined_text += "Could not parse any valid coordinates from your image(s)."
        else:
            combined_text += "No coordinates were detected in the image(s)."

    # build invalid‑coord table
    if aggregated_invalid:
        tbl = (
            "<table border='1' style='border-collapse:collapse;font-size:0.9rem;'>"
            "<tr style='background:#2c2d3a;'><th>Latitude</th><th>Longitude</th></tr>"
        )
        for ic in aggregated_invalid:
            if isinstance(ic, dict):
                lat = ic.get("lat") or ic.get("input", {}).get("latitude", "")
                lon = ic.get("lon") or ic.get("input", {}).get("longitude", "")
            elif isinstance(ic, (list, tuple)):
                lat = ic[0] if len(ic) > 0 else ""
                lon = ic[1] if len(ic) > 1 else ""
            else:
                lat = lon = ""
            tbl += f"<tr><td style='padding:4px'>{lat}</td><td style='padding:4px'>{lon}</td></tr>"
        tbl += "</table>"
        combined_text += "Invalid coordinates:" + tbl

    #print("aggregated_valid",aggregated_valid)

    # return JSON
    #print(aggregated_urls)
    return JsonResponse({
        "response": combined_text,
        "coordinates": aggregated_valid,
        "image_urls": aggregated_urls
    })
