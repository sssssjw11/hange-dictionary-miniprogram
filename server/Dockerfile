FROM python:3.12-slim
WORKDIR /app
COPY server/requirements.txt ./server/requirements.txt
RUN pip install --no-cache-dir -r server/requirements.txt
COPY server ./server
COPY miniprogram/data/learning.json ./miniprogram/data/learning.json
ENV HANGE_DICT_DATA_DIR=/data
EXPOSE 18748
CMD ["python", "server/app.py", "--host", "0.0.0.0", "--port", "18748"]
