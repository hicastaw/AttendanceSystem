FROM node:24-bookworm-slim@sha256:55fb5f5a527ea2c5c4a95f963e48ef90aa38c7b346054fdc8ee9957a2b55d205
RUN apt-get update && apt-get install -y --no-install-recommends python3 python3-venv build-essential libglib2.0-0 libgomp1 \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY AIOT/requirements-base.txt AIOT/requirements-cpu.txt AIOT/constraints-laptop-py311.txt /app/AIOT/
COPY tools/requirements-test.txt /app/tools/requirements-test.txt
RUN python3 -m venv /opt/venv && /opt/venv/bin/pip install --no-cache-dir -r /app/tools/requirements-test.txt && /opt/venv/bin/pip check
COPY AIOT/server/package.json AIOT/server/package-lock.json /app/AIOT/server/
RUN cd /app/AIOT/server && npm ci --omit=dev --no-audit --no-fund
COPY AIOT/embedding-contract.json /app/AIOT/embedding-contract.json
COPY AIOT/edge/*.py /app/AIOT/edge/
COPY AIOT/server/src /app/AIOT/server/src
COPY AIOT/server/public /app/AIOT/server/public
COPY tools/cpu_model_tool.py tools/model_cpu_lab.py tools/validate_real_pipeline.py tools/run_cpu_test_worker.py tools/browser_camera.py /app/tools/
COPY deploy/r50-docker /app/deploy/r50-docker
RUN mkdir -p /app/AIOT/edge/model /tmp/aiot-software-test-docker && chown -R node:node /app /tmp/aiot-software-test-docker
USER node
EXPOSE 3080
CMD ["node", "deploy/r50-docker/start.mjs"]
