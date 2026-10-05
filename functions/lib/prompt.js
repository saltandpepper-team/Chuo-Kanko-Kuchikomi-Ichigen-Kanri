const { MEDIA, LANG, isLow } = require("./constants");

const DEFAULT_STYLE = `【お手本1】
山本様
この度はご来店いただき、誠にありがとうございます。旬の魚を使ったお造りをお楽しみいただけたとのこと、板場一同とても励みになります。季節ごとに内容を変えておりますので、またのお越しを心よりお待ちしております。
スタッフ一同

【お手本2】
ご意見をお寄せいただき、ありがとうございます。お料理の提供にお時間をいただいてしまい、大変申し訳ございませんでした。混雑時のご案内の仕方を見直し、スタッフ全員で共有いたしました。またの機会にお越しいただけましたら幸いです。
スタッフ一同`;

function buildPrompt(review, styleSample) {
  const lang = LANG[review.lang] || "口コミと同じ言語";
  const style = (styleSample || DEFAULT_STYLE).slice(0, 4000);
  return `あなたは観光地の飲食店「${review.store}」の口コミ返信担当です。下の「お手本」の言葉づかい・長さ・署名のスタイルに合わせて、口コミへの返信文を1つだけ書いてください。

ルール:
- ${lang}で書く${review.lang !== "ja" ? "。返信の後に「---」だけの行を入れ、その下に日本語訳を付ける" : ""}
- 口コミの具体的な内容に1つ以上触れる
- 低評価の場合は、言い訳をせずにお詫びし、改善の姿勢を示す。できない約束はしない
- 質問があれば丁寧に答えるか、確認方法を案内する（予約はお電話または公式サイトからと案内）
- 誇張・絵文字・ハッシュタグは使わない。Instagramのコメントは3〜4文と短めにする
- 前置きや説明は書かず、返信文だけを出力する

媒体: ${MEDIA[review.media].label}
投稿者: ${review.author}
評価: ${review.rating == null ? "なし（コメント）" : review.rating + " / 5"}
口コミ:
${review.text}

お手本:
${style}`;
}

function splitJa(text) {
  const parts = String(text).split(/\n-{3,}\n/);
  return parts.length < 2 ? [text.trim(), ""] : [parts[0].trim(), parts.slice(1).join("\n").trim()];
}

function fallbackDraft(review) {
  const r = review;
  const sign = `${r.store} スタッフ一同`;
  const nm = r.author.split(/ \(|（/)[0];
  if (r.lang === "en" && isLow(r)) {
    return `Dear ${nm},\nThank you for your feedback, and we sincerely apologize for the long wait and for not letting you know the reason. We have shared your comments with our whole team and will improve how we communicate with guests during busy times. We hope to have the chance to welcome you again.\n${r.store} Staff\n---\n${nm}様\nご意見をお寄せいただきありがとうございます。長くお待たせしたうえ、理由もお伝えできず、大変申し訳ございませんでした。いただいた内容はスタッフ全員で共有し、混雑時のお客様へのご案内を改善してまいります。またお迎えできる機会をいただけましたら幸いです。\n${sign}`;
  }
  if (r.lang === "en" && r.media === "instagram") {
    return `Thank you so much for your comment! Yes, we have an English menu available, so please feel free to ask our staff. We look forward to seeing you soon.\n---\nコメントありがとうございます！英語のメニューをご用意していますので、お気軽にスタッフへお声がけください。お会いできるのを楽しみにしております。`;
  }
  if (r.lang === "en") {
    return `Dear ${nm},\nThank you so much for your kind review. We are delighted that you enjoyed your time with us, and we hope to welcome you again on your next visit to Japan.\n${r.store} Staff\n---\n${nm}様\n温かいレビューをありがとうございます。楽しい時間をお過ごしいただけたこと、大変嬉しく思います。また日本にお越しの際はぜひお立ち寄りください。\n${sign}`;
  }
  if (r.lang === "zh-TW" && r.media === "instagram") {
    return `謝謝您的留言！我們有提供素食餐點，詳情歡迎來電或於官方網站確認。期待您的光臨。\n---\nコメントありがとうございます！ベジタリアン向けのお料理もご用意しております。詳しくはお電話または公式サイトでご確認ください。お越しをお待ちしております。`;
  }
  if (r.lang === "zh-TW") {
    return `${nm}您好，\n感謝您的評價與寶貴意見。很高興您喜歡我們的餐點。關於中文菜單，我們會積極研究改進。期待您再次光臨。\n${r.store} 全體員工\n---\n${nm}様\nご評価と貴重なご意見をありがとうございます。お料理を気に入っていただけて嬉しく思います。中国語のメニューについては前向きに検討いたします。またのご来店をお待ちしております。\n${sign}`;
  }
  if (r.lang === "zh-CN") {
    return `${nm}您好，\n非常感谢您的好评！很高兴您喜欢我们的料理和店里的氛围。期待您下次再来，我们会用心为您服务。\n${r.store} 全体员工\n---\n${nm}様\n温かいご評価をありがとうございます。お料理とお店の雰囲気を気に入っていただけて大変嬉しく思います。またのお越しを心よりお待ちしております。\n${sign}`;
  }
  if (isLow(r)) {
    return `${r.author}様\nこの度はご来店いただき、またご意見をお寄せいただきありがとうございます。ご不快な思いをおかけし、大変申し訳ございませんでした。いただいた内容はスタッフ全員で共有し、改善に努めてまいります。またの機会にお越しいただけましたら幸いです。\n${sign}`;
  }
  if (r.media === "instagram") {
    return `コメントありがとうございます！楽しんでいただけて嬉しいです。ご予約はお電話または公式サイトから承っております。またのお越しをお待ちしています。`;
  }
  return `${r.author}様\nこの度はご来店いただき、誠にありがとうございます。お楽しみいただけたとのこと、スタッフ一同大変嬉しく思っております。またのお越しを心よりお待ちしております。\n${sign}`;
}

module.exports = { buildPrompt, splitJa, fallbackDraft, DEFAULT_STYLE };
