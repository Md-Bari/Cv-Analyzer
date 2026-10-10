from django.urls import path

from . import views

urlpatterns = [
    path("health/", views.health, name="health"),
    path("analyze/", views.AnalyzeView.as_view(), name="analyze"),
]
