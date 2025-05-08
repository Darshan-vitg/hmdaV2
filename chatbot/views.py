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
        raise ValueError("Conversion failed for value: {}".format(value))


@csrf_exempt
def index(request):
    return render(request, 'index.html')


@csrf_exempt
def handle_prompt(request):
    if request.method != 'POST':
        return JsonResponse({'error': 'Only POST method allowed'}, status=405)

    prompt_id = request.POST.get('prompt_id') or str(uuid.uuid4())
    message = request.POST.get('message')
    images = request.FILES.getlist('image')
    image_provided = True if images else False
    is_same_lake = request.POST.get("is_same_lake") == "on"

    # Get chat histories dictionary from session
    chat_histories = request.session.get('chat_histories', {})
    # Get chat history for this specific prompt_id
    chat_history = chat_histories.get(prompt_id, [])

    # Prepare payload
    payload = {
        'prompt_id': prompt_id,
        'message': message,
        'chat_history': chat_history, # Send only this prompt's history
        'is_same_lake': is_same_lake
    }

    # Initialize response_data in case there are no images
    response_data = {}

    # If no images are provided, process a single payload (with only message).
    if not images:
        try:
            response = requests.post(
                LAMBDA_API_URL,
                data=json.dumps(payload),
                headers={'Content-Type': 'application/json'}
            )
            response_data = response.json()
            print(response_data.get("response", ""))
        except Exception as e:
            return JsonResponse({'error': 'Error communicating with Lambda: {}'.format(str(e))})
        # Update this prompt's chat history in the session
        if 'chat_history' in response_data:
            chat_histories[prompt_id] = response_data['chat_history']
            request.session['chat_histories'] = chat_histories
            request.session.modified = True
        return JsonResponse(response_data)

    # Process each uploaded image concurrently.
    # Process each uploaded image concurrently.
    def process_image(image_file):
        # Save image temporarily.
        temp_path = default_storage.save(image_file.name, image_file)
        with default_storage.open(temp_path, 'rb') as f:
            encoded_image = base64.b64encode(f.read()).decode('utf-8')
        default_storage.delete(temp_path)

        # Build payload including prompt_id, message, and the encoded image.
        payload = {'prompt_id': prompt_id, 'image': encoded_image, 'chat_history': chat_history}
        if message:
            payload['message'] = message

        try:
            lambda_response = requests.post(
                LAMBDA_API_URL,
                data=json.dumps(payload),
                headers={'Content-Type': 'application/json'}
            )
            # Ensure the response is in JSON format
            result = lambda_response.json()

            # If the result is a list, convert it to a dict for consistency.
            if isinstance(result, list):
                result = {'error': 'Unexpected response format: list instead of dict'}

        except Exception as e:
            result = {'error': f"Error processing image {image_file.name}: {str(e)}"}

        # Add image name to the result dictionary
        result['image_name'] = image_file.name
        return result

    with ThreadPoolExecutor() as executor:
        results = list(executor.map(process_image, images))

    # Aggregate data from all image responses.
    aggregated_valid_coordinates = []
    aggregated_invalid_coordinates = []
    aggregated_image_urls = []
    combined_response_text = ""

    print(results)
    for idx, res in enumerate(results):
        if res.get('error'):
            combined_response_text += (
                f"Error processing {res.get('image_name')}: {res.get('error')}"
            )
            continue

        valid_coords_raw = res.get("valid_coordinates", [])
        lake_coords = []

        for coord in valid_coords_raw:
            if isinstance(coord, (list, tuple)) and len(coord) >= 2:
                try:
                    lat_value = convert_to_float(coord[0])
                    lon_value = convert_to_float(coord[1])
                    coord_dict = {"lat": lat_value, "lon": lon_value}

                    if is_same_lake:
                        aggregated_valid_coordinates.append(coord_dict)
                    else:
                        lake_coords.append(coord_dict)


                except Exception:
                    aggregated_invalid_coordinates.append(coord)

            elif isinstance(coord, dict):
                raw_lat = coord.get("lat") if coord.get("lat") is not None else coord.get("latitude")
                raw_lon = coord.get("lon") if coord.get("lon") is not None else coord.get("longitude")
                try:
                    lat_value = convert_to_float(raw_lat)
                    lon_value = convert_to_float(raw_lon)
                    coord_dict = {"lat": lat_value, "lon": lon_value}

                    if is_same_lake:
                        aggregated_valid_coordinates.append(coord_dict)
                    else:
                        lake_coords.append(coord_dict)

                except Exception:
                    aggregated_invalid_coordinates.append(coord)
            else:
                aggregated_invalid_coordinates.append(coord)

        more_invalid = res.get("invalid_coordinates", [])
        if more_invalid:
            aggregated_invalid_coordinates.extend(more_invalid)

        if not is_same_lake and lake_coords:
            aggregated_valid_coordinates.append({
                "lake_name": f"Lake {idx + 1}",
                "coordinates": lake_coords
            })

        if "image_urls" in res and isinstance(res["image_urls"], list):
            for url in res["image_urls"]:
                if isinstance(url, str) and url.strip():
                    aggregated_image_urls.append(url.strip())
        elif res.get("image_url", "").strip():
            aggregated_image_urls.append(res.get("image_url").strip())

        combined_response_text += res.get("response", "")

    if image_provided and not aggregated_valid_coordinates:
        combined_response_text += "No valid coordinates found."


    #print(aggregated_invalid_coordinates)

    if aggregated_invalid_coordinates:
        table_html = """
        <table border="1" style="border-collapse: collapse; font-size: 0.9rem;">
            <tr style="background-color: #2c2d3a;"><th>Latitude</th><th>Longitude</th></tr>
        """

        for ic in aggregated_invalid_coordinates:

            if isinstance(ic, dict):
                lat_val = ic.get("lat") if ic.get("lat") is not None else ic.get('input', {}).get("latitude", "")
                lon_val = ic.get("lon") if ic.get("lon") is not None else ic.get('input', {}).get("longitude", "")
            elif isinstance(ic, (list, tuple)):
                lat_val = ic[0] if len(ic) > 0 else ""
                lon_val = ic[1] if len(ic) > 1 else ""
            else:
                lat_val, lon_val = "", ""
            table_html += (
                f"<tr><td style='padding: 4px;'>{lat_val}</td>"
                f"<td style='padding: 4px;'>{lon_val}</td></tr>"
            )

        table_html += "</table>"
        combined_response_text += "Invalid coordinates:" + table_html

    # Update this prompt's chat history in the session
    if 'chat_history' in response_data:
        chat_histories[prompt_id] = response_data['chat_history']
        request.session['chat_histories'] = chat_histories
        request.session.modified = True
    print(aggregated_valid_coordinates)
    return JsonResponse({
        "response": combined_response_text,
        "coordinates": aggregated_valid_coordinates,
        "image_urls": aggregated_image_urls
    })
