// Safe for client and server. No DB or secrets here.

/**
 * Placeholders available in copy strings:
 *   {shopper} – the board owner's first name
 *   {partner} – the voter's first name
 *   {count}   – the number of items on the board
 */
export const DEFAULT_COPY = {
  voteHeadline:    "{shopper} wants your vote",
  voteIntro:       "Swipe through {count} pieces. It only takes a minute.",
  loveLabel:       "Love It",
  maybeLabel:      "Maybe",
  passLabel:       "Not For Us",
  thanksHeadline:  "Thanks, {partner}.",
  thanksBody:      "{shopper} can see your votes now.",
  expiredHeadline: "This board has closed",
  expiredBody:     "Ask {shopper} to share a new link.",
  resultsHeadline:        "{partner} loved {loved} of {total}.",
  resultsNoneLoved:       "{partner} didn't love any of these.",
  resultsWaitingHeadline: "{partner} is voting.",
  resultsCta:             "Add Loved to Cart",
  passReasonTitle:  "What's not right?",
  maybeReasonTitle: "What would make it a yes?",
  reasonHint:       "Optional. {shopper} will see your answer.",
  otherReasonHint:  "{shopper} and TOV will see what you write.",
};

export const LIMITS = {
  boardExpiryDays:     [1, 90],
  maxItemsPerBoard:    [1, 30],
  maxSharesPerDay:     [1, 100],
  copyMaxLength:       200,
  excludeTagMaxLength: 40,
};
