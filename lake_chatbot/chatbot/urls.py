from django.urls import path
from . import views

urlpatterns = [
    path('', views.index, name='index'),
    path('handle_prompt/', views.handle_prompt, name='handle_prompt'),
]
