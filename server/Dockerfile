FROM python:3.12-slim
COPY --from=ghcr.io/astral-sh/uv:latest /uv /uvx /bin/

WORKDIR /srv

ENV UV_COMPILE_BYTECODE=1
ENV UV_LINK_MODE=copy

COPY pyproject.toml uv.lock ./

RUN uv sync --frozen --no-dev

# Optional: Google Calendar read-only display needs the cryptography package.
# Build with: docker build --build-arg WITH_GOOGLE=1 .
ARG WITH_GOOGLE=0
RUN if [ "$WITH_GOOGLE" = "1" ]; then uv sync --frozen --no-dev --group google; fi

ENV PATH="/srv/.venv/bin:$PATH"

COPY app ./app
ENV SYNC_DB=/data/lifedash.db
VOLUME /data
EXPOSE 8787
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8787", "--no-proxy-headers"]
