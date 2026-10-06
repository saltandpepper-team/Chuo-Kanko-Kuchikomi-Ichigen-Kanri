// 食べログ「口コミ返信」ページのテキストから口コミを読み取る（アプリ本体 public/index.html と同じロジック）
/* eslint-disable no-unused-vars */
function guessLang(t){
  t=String(t||'');
  if(/[぀-ヿ]/.test(t)) return 'ja';
  if(/[一-鿿]/.test(t)) return /[們個這說時會來為對問點華灣鐘體]/.test(t)?'zh-TW':'zh-CN';
  return /[a-z]/i.test(t)?'en':'ja';
}
const TB_DATE=/'(\d{2})\/(\d{1,2})\/(\d{1,2})/;
const TB_AUTHOR=/^(.+?)\s*[（(]\s*([\d,]+)\s*[)）]/;
const TB_SKIP=/^(使った金額|[¥￥]|[（(](テイクアウト|デリバリー|その他|夜|昼)|[\[［]|料理・味|サービス|雰囲気|CP|酒・ドリンク|[\]］]|[-－―ー—|｜]+$|\d+$|認証済|夜の点数|昼の点数|訪問理由)/;
const TB_FOOTER=/^(前の\d+件|次の\d+件|次へ|前へ|ページの先頭|表示件数|Copyright|©|会社情報|利用規約|プライバシー)/;
const TB_UI=/^(AIが作成した返信文です|返信文を確認しています|返信文がまだありません|書き直すときは|AIが返信文を作成しています|AIで作成できませんでした|AIで作り直す|返信する|返信を書く|この口コミに返信|口コミに返信|返信内容を入力|送信する|確認する|もっと見る|続きを読む|いいね|保存|通報|写真をもっと見る)/;
// 画面のボタン・リンク（[ 編集 ]、[ この口コミに返信 ] など）と、数字＋？だけの行（参考になった数などのアイコン）
const TB_NOISE=/^([\[［]\s*[^\]］]{1,20}\s*[\]］]|\d+\s*[？?])$/;
const TB_REPLIED=/(店舗からの返信|お店からの返信|店舗からのお礼|お店からのコメント|返信済み)/;
/** 「口コミ返信」ページをコピーしたテキストから口コミを読み取る */
function parseTabelog(raw){
  const L=String(raw).replace(/\r/g,'').split('\n').map(x=>x.replace(/ /g,' ').trim()).filter(Boolean);
  const starts=[];
  for(let i=0;i<L.length;i++){
    if(!TB_DATE.test(L[i])) continue;
    const near=L.slice(i,i+2).join(' ');
    if(!/訪問/.test(near)) continue;
    // 日付の前後どちらかがタイトル、その次が「投稿者名（件数）」
    let a=-1; for(let k=i+1;k<=i+3&&k<L.length;k++){ if(TB_AUTHOR.test(L[k]) && !TB_DATE.test(L[k])){ a=k; break; } }
    if(a<0) continue;
    const titleIdx = (a===i+1 || /訪問/.test(L[i+1]||'') && a===i+2) ? i-1 : i+1;
    starts.push({i, a, t:titleIdx, s:Math.min(i,titleIdx)});
  }
  const out=[];
  starts.forEach((st,n)=>{
    let end = n+1<starts.length ? starts[n+1].s : L.length;
    for(let k=st.a+1;k<end;k++){ if(TB_FOOTER.test(L[k])){ end=k; break; } }
    const block=L.slice(st.a+1,end);
    const [,yy,mm,dd]=L[st.i].match(TB_DATE);
    const au=L[st.a].match(TB_AUTHOR);
    let rating=null;
    for(const x of block.slice(0,4)){ const m=x.match(/(?:^|\s)([1-5]\.\d{1,2})(?=\s|$|\s*[\[［])/); if(m){ rating=+m[1]; break; } }
    let k=0;
    const head=block.findIndex(x=>/^使った金額/.test(x));
    k = head>=0 ? head+1 : 0;
    while(k<block.length && (TB_SKIP.test(block[k]) || /^[1-5]\.\d{1,2}/.test(block[k]))) k++;
    let body=[], reply=[], inReply=false;
    for(;k<block.length;k++){
      const x=block[k];
      if(TB_REPLIED.test(x)){ inReply=true; continue; }
      if(TB_UI.test(x) || TB_NOISE.test(x)) continue;
      (inReply?reply:body).push(x);
    }
    // タイトルと日付が同じ行にある場合は、日付より前の部分をタイトルとする
    const inline=L[st.i].slice(0,L[st.i].search(TB_DATE)).trim();
    const title=inline || ((L[st.t]&&st.t>=0&&!TB_DATE.test(L[st.t])&&st.t!==starts[n-1]?.a)?L[st.t]:'');
    const text=[title?`【${title}】`:'',...body].filter(Boolean).join('\n');
    if(!text) return;
    out.push({media:'tabelog', author:au[1].trim(), rating, lang:guessLang(text), text,
      date:`${+mm}/${+dd}`, reply:reply.join('\n'), title,
      extId:'tabelog:'+[au[1].trim(),`20${yy}/${mm}/${dd}`,title||body[0]||''].join('|').slice(0,200)});
  });
  return out;
}
