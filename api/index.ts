import { createApp } from "../server";

const app = createApp();

export default {
  fetch: (request: Request) => app.fetch(request)
};

// If you prefer edge runtime, uncomment:
// export const config = { runtime: "edge" };
