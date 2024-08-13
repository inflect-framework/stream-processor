FROM node:21

WORKDIR /usr/src/app

COPY partition-scaler/package*.json ./
RUN npm install

COPY partition-scaler/src ./src

CMD [ "node", "src/partition-scaler.js" ]