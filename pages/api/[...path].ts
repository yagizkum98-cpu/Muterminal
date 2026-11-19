import type { NextApiRequest, NextApiResponse } from 'next';
import { serveApi } from '../../server/application';

export const config = { api: { bodyParser: false } };

export default async function handler(request: NextApiRequest, response: NextApiResponse) {
  if (!Array.isArray(request.query.path)) {
    response.status(404).end();
    return;
  }
  await serveApi(request, response, '/api/' + request.query.path.join('/'));
}
