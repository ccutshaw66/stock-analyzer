FROM python:3.11-slim
WORKDIR /app
RUN pip install fastapi uvicorn pyyaml
COPY dashboard_web.py .
COPY state ./state
CMD ["python", "dashboard_web.py"]
