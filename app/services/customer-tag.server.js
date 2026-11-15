/**
 * Customer tagging helper.
 * Checks userErrors from tagsAdd mutation.
 */
import { log } from "../utils/log.server.js";

/**
 * Add a tag to a customer via Admin API.
 * @param {object} admin - Shopify Admin API client
 * @param {string} customerId - Customer GID
 * @param {string} tag - Tag to add
 * @returns {Promise<{ ok: boolean, code: string }>}
 */
export async function addBuyerTag(admin, customerId, tag) {
  try {
    const response = await admin.graphql(
      `mutation TagCustomer($id: ID!, $tags: [String!]!) {
        tagsAdd(id: $id, tags: $tags) {
          userErrors { message }
        }
      }`,
      { variables: { id: customerId, tags: [tag] } }
    );

    const json = await response.json();

    // Check for GraphQL-level errors
    if (json.errors?.length) {
      return { ok: false, code: "graphql_error" };
    }

    // Check for userErrors in the mutation response
    const userErrors = json.data?.tagsAdd?.userErrors || [];
    if (userErrors.length > 0) {
      return { ok: false, code: "user_error" };
    }

    return { ok: true, code: "success" };
  } catch {
    log.warn("customer_tag.exception", { code: "exception" });
    return { ok: false, code: "exception" };
  }
}
