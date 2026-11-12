/**
 * Packaged query metadata observed in X's public web bundle on 2026-11-12.
 * UserByScreenName parameters also match an observed successful page request.
 * Private query IDs and response fields may change; this is not a stable API
 * guarantee. No remote JavaScript is downloaded or executed by this module.
 */
const COMMON_FEATURES = Object.freeze({
  hidden_profile_subscriptions_enabled: true,
  profile_label_improvements_pcf_label_in_post_enabled: true,
  responsive_web_profile_redirect_enabled: true,
  rweb_tipjar_consumption_enabled: false,
  verified_phone_label_enabled: false,
  highlights_tweets_tab_ui_enabled: true,
  responsive_web_twitter_article_notes_tab_enabled: true,
  subscriptions_feature_can_gift_premium: false,
  creator_subscriptions_tweet_preview_api_enabled: true,
  responsive_web_graphql_timeline_navigation_enabled: true
});
const QUERY_IDS = Object.freeze({
  Viewer: 'TpQxQtWMTMnIAMPlMGMqNw',
  UserByScreenName: 'AMIBMjtxEEATh4z8V9GtRg',
  UserByRestId: 'mxaYWwt52eAb6OAzYHMVzg'
});
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const validId = value => typeof value === 'string' && /^\d{1,25}$/.test(value) && !/^0+$/.test(value);
const handle = value => typeof value === 'string' && /^[a-zA-Z0-9_]{1,15}$/.test(value) ? value.toLowerCase() : null;

// X's own fetchViewer uses this authenticated query for VERIFY_CREDENTIALS.
// No requested account ID or handle can replace the server-selected viewer.
export function graphqlViewerURL() {
  const params = new URLSearchParams({
    variables: JSON.stringify({withCommunitiesMemberships: false}),
    features: JSON.stringify({
      subscriptions_upsells_api_enabled: false,
      profile_label_improvements_pcf_label_in_post_enabled: true,
      responsive_web_profile_redirect_enabled: true,
      rweb_tipjar_consumption_enabled: false,
      verified_phone_label_enabled: false,
      creator_subscriptions_tweet_preview_api_enabled: true,
      responsive_web_graphql_timeline_navigation_enabled: true
    }),
    fieldToggles: JSON.stringify({withAuxiliaryUserLabels: true, isDelegate: false})
  });
  return `https://x.com/i/api/graphql/${QUERY_IDS.Viewer}/Viewer?${params}`;
}

export function graphqlUserURL(operation, value) {
  const byName = operation === 'UserByScreenName';
  if ((!byName && operation !== 'UserByRestId') || (byName ? !handle(value) : !validId(value))) {
    throw new TypeError('Invalid packaged X user query.');
  }
  const variables = byName ? {screen_name: handle(value), withGrokTranslatedBio: true}
    : {userId: value, withSafetyModeUserFields: true};
  const features = byName ? {...COMMON_FEATURES,
    subscriptions_verification_info_is_identity_verified_enabled: true,
    subscriptions_verification_info_verified_since_enabled: true} : COMMON_FEATURES;
  const params = new URLSearchParams({variables: JSON.stringify(variables), features: JSON.stringify(features),
    fieldToggles: JSON.stringify({withPayments: false, withAuxiliaryUserLabels: true})});
  return `https://x.com/i/api/graphql/${QUERY_IDS[operation]}/${operation}?${params}`;
}

export class GraphqlUserError extends Error {
  constructor(kind = 'response') {
    super(kind === 'response' ? 'X did not confirm the requested user identity and relationship.'
      : 'X reports that the target account is unavailable.');
    this.name = 'GraphqlUserError';
    this.kind = kind;
  }
}

function parseUserResult(result, {expectedHandle, expectedId, requireRelationship = false, requireHandle = false, strictType = false} = {}) {
  const fail = (kind = 'response') => {throw new GraphqlUserError(kind);};
  if (!object(result)) fail();
  if (result.__typename === 'UserUnavailable') fail('target_unavailable');
  if ((strictType || result.__typename !== undefined) && result.__typename !== 'User') fail();
  if (!validId(result.rest_id) || (expectedId !== undefined && result.rest_id !== expectedId)) fail();
  for (const field of ['core', 'legacy', 'relationship_perspectives']) {
    if (Object.hasOwn(result, field) && !object(result[field])) fail();
  }
  if (result.legacy && Object.hasOwn(result.legacy, 'id_str') && result.legacy.id_str !== result.rest_id) fail();
  for (const value of [result, result.legacy]) {
    if (value?.suspended === true) fail('target_suspended');
    if (value?.deactivated === true || value?.deactivated_bit === true) fail('target_unavailable');
  }
  const handles = [result.core, result.legacy].filter(value => value && Object.hasOwn(value, 'screen_name')).map(value => handle(value.screen_name));
  if (handles.some(value => !value) || new Set(handles).size > 1 || (requireHandle && !handles.length) || (expectedHandle !== undefined && handles[0] !== expectedHandle)) fail();
  const relationships = [result.relationship_perspectives, result.legacy]
    .filter(value => value && Object.hasOwn(value, 'blocking')).map(value => value.blocking);
  if (relationships.some(value => typeof value !== 'boolean') || new Set(relationships).size > 1 || (requireRelationship && !relationships.length)) fail();
  return {targetId: result.rest_id, ...(handles.length ? {handle: handles[0]} : {}),
    ...(relationships.length ? {blocking: relationships[0]} : {})};
}

function checkEnvelope(document) {
  if (!object(document) || Object.hasOwn(document, 'errors') || Object.hasOwn(document, 'error')) throw new GraphqlUserError();
}

/** Only the exact UserByScreenName / UserByRestId result may supply identity. */
export function parseGraphqlUser(document, constraints) {
  checkEnvelope(document);
  return parseUserResult(document.data?.user?.result, constraints);
}

/** Never substitute a target lookup or another user nested elsewhere in data. */
export function parseGraphqlViewer(document) {
  checkEnvelope(document);
  return parseUserResult(document.data?.viewer?.user_results?.result, {requireHandle: true, strictType: true});
}
