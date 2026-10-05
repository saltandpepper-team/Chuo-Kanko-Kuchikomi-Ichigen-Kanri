const { draftReply } = require("./lib/claude");
const { getIntegrationStatus } = require("./lib/integrationStatus");
const {
  createGoogleConnectUrl,
  googleOAuthCallback,
  listGoogleLocations,
  setGoogleLocation,
  syncGoogleReviews,
  syncGoogleReviewsNow,
  postGoogleReply,
} = require("./lib/google");
const {
  createInstagramConnectUrl,
  instagramOAuthCallback,
  listInstagramAccounts,
  setInstagramAccount,
  syncInstagramComments,
  syncInstagramCommentsNow,
  postInstagramReply,
} = require("./lib/instagram");

exports.draftReply = draftReply;
exports.getIntegrationStatus = getIntegrationStatus;

exports.createGoogleConnectUrl = createGoogleConnectUrl;
exports.googleOAuthCallback = googleOAuthCallback;
exports.listGoogleLocations = listGoogleLocations;
exports.setGoogleLocation = setGoogleLocation;
exports.syncGoogleReviews = syncGoogleReviews;
exports.syncGoogleReviewsNow = syncGoogleReviewsNow;
exports.postGoogleReply = postGoogleReply;

exports.createInstagramConnectUrl = createInstagramConnectUrl;
exports.instagramOAuthCallback = instagramOAuthCallback;
exports.listInstagramAccounts = listInstagramAccounts;
exports.setInstagramAccount = setInstagramAccount;
exports.syncInstagramComments = syncInstagramComments;
exports.syncInstagramCommentsNow = syncInstagramCommentsNow;
exports.postInstagramReply = postInstagramReply;
