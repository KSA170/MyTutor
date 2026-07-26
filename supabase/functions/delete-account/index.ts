/**
 * delete-account — App Store requirement: full in-app account deletion.
 *
 * POST { confirm: "DELETE" } with the user's JWT. Removes storage objects,
 * then the auth user (every table cascades via FK).
 */

import {
  corsHeaders,
  errorResponse,
  HttpError,
  jsonResponse,
  requireUser,
  serviceClient,
  userClient,
} from "../_shared/db.ts";
import {
  EXPORTS_BUCKET,
  MATERIALS_BUCKET,
} from "../../../packages/shared/src/protocol.ts";

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  try {
    const supabase = userClient(req);
    const user = await requireUser(supabase);
    const body = await req.json().catch(() => ({}));
    if (body.confirm !== "DELETE") {
      throw new HttpError(400, 'Pass { "confirm": "DELETE" } to delete the account');
    }

    const service = serviceClient();

    for (const bucket of [MATERIALS_BUCKET, EXPORTS_BUCKET]) {
      // Storage list is not recursive: walk the user's prefix tree.
      const toDelete: string[] = [];
      const stack = [user.id];
      while (stack.length > 0) {
        const prefix = stack.pop()!;
        const { data: entries } = await service.storage.from(bucket).list(
          prefix,
          { limit: 1000 },
        );
        for (const entry of entries ?? []) {
          const path = `${prefix}/${entry.name}`;
          if (entry.id === null) stack.push(path); // folder
          else toDelete.push(path);
        }
      }
      for (let i = 0; i < toDelete.length; i += 100) {
        await service.storage.from(bucket).remove(toDelete.slice(i, i + 100));
      }
    }

    const { error } = await service.auth.admin.deleteUser(user.id);
    if (error) throw new Error(error.message);

    return jsonResponse({ deleted: true });
  } catch (err) {
    return errorResponse(err);
  }
});
