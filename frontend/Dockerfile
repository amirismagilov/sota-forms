FROM node:20-alpine

WORKDIR /app

COPY package.json ./
RUN npm install

COPY . .

# Pre-build the embeddable widget bundle so /form-widget.js is served.
RUN npm run build:widget

EXPOSE 5173

CMD ["npm", "run", "dev"]
