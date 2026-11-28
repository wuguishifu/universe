import { httpRouter } from 'convex/server';

import { auth } from './auth';
import { routes } from './routes';

const http = httpRouter();

// Convex Auth's routes, including /.well-known/jwks.json for services that verify its tokens.
auth.addHttpRoutes(http);

routes.forEach((route) => http.route(route));

export default http;
