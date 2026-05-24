# Markov strategy service — FastAPI wrapper around markov_trading_v2.py.
# Same Railway-friendly pattern as the HERMES service.
FROM python:3.12-slim

WORKDIR /app

# Install deps first so the layer cache survives source edits.
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy the strategy module and the FastAPI app.
COPY markov_trading_v2.py app.py ./

# Railway sets $PORT; default to 8000 locally.
ENV PORT=8000
EXPOSE 8000

CMD ["sh", "-c", "uvicorn app:app --host 0.0.0.0 --port ${PORT:-8000}"]
