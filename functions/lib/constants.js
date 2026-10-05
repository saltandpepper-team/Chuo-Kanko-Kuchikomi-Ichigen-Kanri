const MEDIA = {
  google: { label: "Google", auto: true, api: "Google Business Profile API" },
  instagram: { label: "Instagram", auto: true, api: "Instagram Graph API" },
  tabelog: { label: "食べログ", auto: false, host: "食べログ 店舗管理画面" },
  tripadvisor: { label: "トリップアドバイザー", auto: false, host: "トリップアドバイザー 管理センター" },
};

const LANG = {
  ja: "日本語",
  en: "英語",
  "zh-TW": "中国語（繁体字）",
  "zh-CN": "中国語（簡体字）",
};

function isLow(review) {
  return review.rating != null && review.rating <= 3;
}

module.exports = { MEDIA, LANG, isLow };
