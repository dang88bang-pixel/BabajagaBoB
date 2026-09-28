FROM python:3.13-slim
WORKDIR /app
COPY privacy-avatar/requirements.txt /app/requirements.txt
RUN pip install --no-cache-dir -r /app/requirements.txt
COPY privacy_avatar /app/privacy_avatar
CMD ["uvicorn","privacy_avatar.app:app","--host","0.0.0.0","--port","8787"]
