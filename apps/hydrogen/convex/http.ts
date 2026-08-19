import { httpRouter } from 'convex/server';
import { routes } from './routes';

const http = httpRouter();

routes.forEach((route) => http.route(route));

export default http;
