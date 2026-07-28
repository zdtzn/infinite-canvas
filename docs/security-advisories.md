# Accepted Dependency Advisory

## React Router RSC CSRF Advisory

`bun audit --production` currently reports `GHSA-qwww-vcr4-c8h2` for React Router 7.

This application uses React Router only as a client-side SPA router through `createBrowserRouter`. It does not use React Server Components, Server Actions, route `action` handlers, `createStaticHandler`, or a React Router server runtime. The Bun server exposes independent JSON endpoints and enforces same-origin checks for state-changing API requests.

The affected RSC request path is therefore not reachable in this deployment. A forced React Router 8 upgrade would be a breaking platform change with more regression risk than security benefit for this application. Keep this exception under review and remove it when a compatible fixed release is available on the current router line or when the application adopts server-side React features.
