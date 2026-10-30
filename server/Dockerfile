FROM python:3.12-slim
WORKDIR /srv
COPY requirements.txt requirements-google.txt ./
RUN pip install --no-cache-dir -r requirements.txt
# Optional: Google Calendar read-only display needs the cryptography package.
# Build with: docker build --build-arg WITH_GOOGLE=1 .
ARG WITH_GOOGLE=0
RUN if [ "$WITH_GOOGLE" = "1" ]; then pip install --no-cache-dir -r requirements-google.txt; fi
COPY app ./app
ENV SYNC_DB=/data/lifedash.db
VOLUME /data
EXPOSE 8787
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8787"]
