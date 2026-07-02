FROM nginx:alpine
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY . /usr/share/nginx/html
# App Vite "monte" (pre-buildado e commitado): serve o dist em /monte/
COPY monte/dist /usr/share/nginx/html/monte
EXPOSE 80
