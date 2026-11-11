// Admin GraphQL (API version July26):
// ProductVariant: id, title, price (Money! scalar), image { url altText },
//   availableForSale, product { id title handle status isGiftCard tags
//   featuredImage { url altText } }
// shop { currencyCode } — shop-level currency code

const VARIANTS_QUERY = `#graphql
  query FetchVariants($ids: [ID!]!) {
    shop {
      currencyCode
    }
    nodes(ids: $ids) {
      ... on ProductVariant {
        id
        title
        price
        image {
          url
          altText
        }
        availableForSale
        product {
          id
          title
          handle
          status
          isGiftCard
          tags
          featuredImage {
            url
            altText
          }
        }
      }
    }
  }
`;

/**
 * Fetch variant details for the given GIDs in one Admin API call.
 * Returns a Map<gid, variantInfo>. Missing or non-variant nodes
 * are absent from the map.
 *
 * @param {object} admin - AdminApiContext from authenticate.public.appProxy
 * @param {string[]} variantGids
 * @returns {Promise<Map<string, object>>}
 */
export async function fetchVariants(admin, variantGids) {
  if (!variantGids.length) return new Map();

  const response = await admin.graphql(VARIANTS_QUERY, {
    variables: { ids: variantGids },
  });
  const json = await response.json();

  if (json.errors?.length) {
    // Throw a coded error; sanitize the code to prevent log pollution.
    const raw  = json.errors[0]?.extensions?.code ?? "GRAPHQL_ERROR";
    const code = String(raw).slice(0, 64).replace(/[^A-Z0-9_]/gi, "_");
    const err  = new Error("upstream_graphql_error");
    err.code   = code;
    throw err;
  }

  const currencyCode = json.data?.shop?.currencyCode ?? null;
  const nodes        = json.data?.nodes ?? [];

  const map = new Map();
  for (const node of nodes) {
    // Nodes that don't match the ProductVariant fragment have no `id` field.
    if (!node || !node.id) continue;

    const img = node.image ?? node.product?.featuredImage ?? null;

    map.set(node.id, {
      variantId:     node.id,
      productId:     node.product?.id ?? null,
      productTitle:  node.product?.title ?? null,
      variantTitle:  node.title ?? null,
      handle:        node.product?.handle ?? null,
      price:         node.price ?? null,
      currencyCode,
      imageUrl:      img?.url ?? null,
      imageAlt:      img?.altText ?? null,
      availableForSale: node.availableForSale ?? false,
      productStatus: node.product?.status ?? null,
      isGiftCard:    node.product?.isGiftCard ?? false,
      tags:          node.product?.tags ?? [],
    });
  }

  return map;
}

/**
 * Returns null if the variant is eligible, or a short reason code if not.
 *
 * @param {object|undefined} variant - entry from fetchVariants map
 * @param {object} settings - ShopSettings row (or defaults)
 * @returns {string|null}
 */
export function checkEligibility(variant, settings) {
  if (!variant)                          return "not_found";
  if (variant.productStatus !== "ACTIVE") return "product_not_active";
  if (variant.isGiftCard)                return "gift_card";
  // Case-insensitive tag match; skip entirely when excludeTag is blank
  const excludeTag = (settings.excludeTag ?? "").toLowerCase();
  if (excludeTag && variant.tags.some((t) => t.toLowerCase() === excludeTag)) {
    return "excluded_tag";
  }
  if (!variant.availableForSale)         return "not_available";
  return null;
}
