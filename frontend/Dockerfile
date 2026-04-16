FROM node:20-alpine
WORKDIR /app
COPY package*.json ./
RUN npm install
COPY src/ ./src/
COPY index.html ./
COPY vite.config.js ./
EXPOSE 5173
CMD ["./node_modules/.bin/vite", "--port=5173", "--host=0.0.0.0"]
