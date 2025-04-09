import os
import uuid
from django.shortcuts import render
from django.views.decorators.csrf import csrf_exempt
from django.http import JsonResponse
from django.core.files.storage import default_storage
import base64
import requests

# Replace with your deployed Lambda URL
LAMBDA_API_URL = 'https://your-lambda-api-url.amazonaws.com/your-path'

@csrf_exempt
def index(request):
    return render(request, 'index.html')

@csrf_exempt
def handle_prompt(request):
    if request.method == 'POST':
        prompt_id = request.POST.get('prompt_id') or str(uuid.uuid4())
        message = request.POST.get('message')
        image = request.FILES.get('image')

        payload = {'prompt_id': prompt_id}

        if message:
            payload['message'] = message

        if image:
            temp_path = default_storage.save(image.name, image)
            with default_storage.open(temp_path, 'rb') as f:
                encoded_image = base64.b64encode(f.read()).decode('utf-8')
            payload['image'] = encoded_image
            default_storage.delete(temp_path)

        # Send request to Lambda
        response = requests.post(LAMBDA_API_URL, json=payload)
        return JsonResponse(response.json())

    return JsonResponse({'error': 'Only POST method allowed'}, status=405)