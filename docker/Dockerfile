# iZerp deck host — upload a PDF, get a zoom-and-pan presentation.
#
# Build from the REPOSITORY ROOT so the library files are in the context:
#   docker build -f docker/Dockerfile -t izerp .
#
# Run:
#   docker run -p 8080:8080 -v "$PWD/decks:/data" izerp
#
# The image ships poppler-utils (pdftoppm) and nothing else — the server is
# Python's standard library, and the presentation pages are iZerp itself.

FROM python:3.12-slim

ARG IZERP_VERSION=dev
ARG CONTAINER_VERSION=dev
ARG VCS_REF=unknown
ARG BUILD_DATE=unknown

LABEL org.opencontainers.image.title="iZerp deck host" \
      org.opencontainers.image.description="Host zoom-and-pan presentations rendered from PDFs, with iZerp." \
      org.opencontainers.image.url="https://github.com/Illustratus/iZerp" \
      org.opencontainers.image.source="https://github.com/Illustratus/iZerp" \
      org.opencontainers.image.documentation="https://github.com/Illustratus/iZerp/blob/main/docker/README.md" \
      org.opencontainers.image.licenses="MIT" \
      org.opencontainers.image.vendor="Illustratus" \
      org.opencontainers.image.version="${CONTAINER_VERSION}" \
      org.opencontainers.image.revision="${VCS_REF}" \
      org.opencontainers.image.created="${BUILD_DATE}"

RUN apt-get update \
 && apt-get install -y --no-install-recommends poppler-utils \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# The container's own code …
COPY docker/app/ /app/
# … and the library it serves. These two files ARE iZerp; the pages the server
# renders link them exactly the way any hand-written deck would.
COPY izerp-lib.js izerp-lib.css /app/static/

ENV IZERP_DATA=/data \
    IZERP_PORT=8080 \
    IZERP_HOST=0.0.0.0 \
    IZERP_VERSION=${IZERP_VERSION} \
    IZERP_CONTAINER_VERSION=${CONTAINER_VERSION} \
    PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1

# Everything the user uploads lives here — mount it wherever you like.
VOLUME ["/data"]
EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
  CMD python3 -c "import urllib.request,os,sys; \
sys.exit(0 if urllib.request.urlopen('http://127.0.0.1:'+os.environ['IZERP_PORT']+'/healthz', timeout=4).status==200 else 1)"

# Runs as root by default so a bind mount owned by any host user just works.
# For a hardened deployment pass --user "$(id -u):$(id -g)" and make sure the
# mounted directory is writable by that user (see docker/README.md).
CMD ["python3", "/app/server.py"]
