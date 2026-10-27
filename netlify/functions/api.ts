import type { Config, Context } from "@netlify/functions";
import { handleApiRequest } from "../../src/server/router";

export default async (req: Request, _context: Context): Promise<Response> => {
  return handleApiRequest(req);
};

export const config: Config = {
  path: "/api/*",
};
