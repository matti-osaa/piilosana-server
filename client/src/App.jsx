import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { io } from "socket.io-client";
import { QRCodeSVG } from "qrcode.react";
import DEFS_FI from "./defs_fi.js";
import { menuColors } from "./menuColors.js";
import { useAudioSystem } from "./hooks/useAudioSystem.js";
import { MultiplayerHero } from "./components/MultiplayerHero.jsx";
import { DailyHeroCard } from "./components/DailyHeroCard.jsx";
import { NextDailyCountdown } from "./components/NextDailyCountdown.jsx";
import { StreakWarning } from "./components/StreakWarning.jsx";
import { FirstTimeWelcome } from "./components/FirstTimeWelcome.jsx";
import { DailyEndResult } from "./components/DailyEndResult.jsx";
import { computePercentile, tierForPercentile, PERCENTILE_TEXTS } from "./hooks/useDailyPercentile.js";
import { DayBoxRow } from "./components/DayBoxRow.jsx";
import { MenuFooter } from "./components/MenuFooter.jsx";
import { PracticeOptionsModal } from "./components/PracticeOptionsModal.jsx";
import { MenuButton } from "./components/MenuButton.jsx";
import { ResultsScreen as ResultsScreenView } from "./components/ResultsScreen.jsx";
import { HelpModal } from "./components/HelpModal.jsx";
import { InflectionModal } from "./components/InflectionModal.jsx";
import { WordInfoModal } from "./components/WordInfoModal.jsx";
import { AchievementsModal } from "./components/AchievementsModal.jsx";
import { HamburgerMenu } from "./components/HamburgerMenu.jsx";
import { AuthPanel } from "./components/AuthPanel.jsx";
import { LobbyEnterName, LobbyChoose, LobbyWaiting } from "./components/MultiplayerLobby.jsx";

// ============================================
// SANAPIILO - Finnish Word Hunt Game
// ============================================

const VERSION = "2.1.0";
const SERVER_URL = window.location.origin;

// Word lists are loaded lazily for fast initial page load
// import() splits them into separate chunks loaded in background

class TrieNode{constructor(){this.c={};this.w=false;}}
function buildTrie(words){const root=new TrieNode();for(const word of words){let n=root;for(const ch of word){if(!n.c[ch])n.c[ch]=new TrieNode();n=n.c[ch];}n.w=true;}return root;}

const EMPTY_SET=new Set();
const EMPTY_TRIE=new TrieNode();

// Per-language configuration
const LANG_CONFIG={
  fi:{
    words:EMPTY_SET, trie:EMPTY_TRIE, loaded:false,
    lw:{a:120,i:108,t:87,n:88,e:80,s:79,l:58,o:53,k:51,u:51,"ä":37,m:33,v:25,r:29,j:20,h:19,y:19,p:18,d:10,"ö":4},
    letterValues:{a:1,i:1,n:1,s:1,t:1,e:1,l:2,o:2,k:2,u:4,"ä":2,m:3,v:4,r:2,j:4,h:4,y:4,p:4,d:7,"ö":7},
    flag:"🇫🇮", name:"Suomi", code:"fi",
  },
  en:{
    words:EMPTY_SET, trie:EMPTY_TRIE, loaded:false,
    lw:{e:127,t:91,a:82,o:75,i:70,n:67,s:63,h:61,r:60,d:43,l:40,c:28,u:28,m:24,w:24,f:22,g:20,y:20,p:19,b:15,v:10,k:8,j:2,x:2,q:1,z:1},
    letterValues:{e:1,a:1,i:1,o:1,n:1,r:1,t:1,l:1,s:1,u:1,d:2,g:2,b:3,c:3,m:3,p:3,f:4,h:4,v:4,w:4,y:4,k:5,j:8,x:8,q:10,z:10},
    flag:"🇬🇧", name:"English", code:"en",
  },
  sv:{
    words:EMPTY_SET, trie:EMPTY_TRIE, loaded:false,
    lw:{a:93,e:100,n:82,r:84,s:63,t:76,i:58,l:52,d:45,k:32,o:41,g:33,m:35,v:24,h:21,f:20,u:18,p:17,b:15,"ä":15,"ö":13,c:13,y:7,"å":13,j:7,x:2,z:1,w:1,q:1},
    letterValues:{a:1,e:1,n:1,r:1,s:1,t:1,d:1,i:1,l:1,o:2,g:2,k:2,m:2,h:3,b:3,f:3,u:3,v:3,p:4,c:4,y:4,"ä":4,"å":4,"ö":4,j:7,x:8,z:10,w:10,q:10},
    flag:"🇸🇪", name:"Svenska", code:"sv",
  },
};

// Lazy loaders — each returns a promise, cached after first call
const _wordLoaders={
  fi:()=>import("./words.js").then(m=>{const w=new Set(m.default.split("|"));LANG_CONFIG.fi.words=w;LANG_CONFIG.fi.trie=buildTrie(w);LANG_CONFIG.fi.loaded=true;return w.size;}),
  en:()=>import("./words_en.js").then(m=>{const w=new Set(m.default.split("|"));LANG_CONFIG.en.words=w;LANG_CONFIG.en.trie=buildTrie(w);LANG_CONFIG.en.loaded=true;return w.size;}),
  sv:()=>import("./words_sv.js").then(m=>{const w=new Set(m.default.split("|"));LANG_CONFIG.sv.words=w;LANG_CONFIG.sv.trie=buildTrie(w);LANG_CONFIG.sv.loaded=true;return w.size;}),
};
const _wordPromises={};
function loadWords(langCode){
  if(!_wordPromises[langCode])_wordPromises[langCode]=_wordLoaders[langCode]();
  return _wordPromises[langCode];
}
// Start loading ALL languages immediately in background (fi first as it's largest)
loadWords("fi");loadWords("en");loadWords("sv");

function getLangConf(lang){return LANG_CONFIG[lang]||LANG_CONFIG.fi;}

function randLetterLang(lang,rng){
  const lw=getLangConf(lang).lw;
  const ls=Object.keys(lw),ws=Object.values(lw),tot=ws.reduce((a,b)=>a+b,0);
  let r=(rng?rng():Math.random())*tot;for(let i=0;i<ls.length;i++){r-=ws[i];if(r<=0)return ls[i];}return ls[ls.length-1];
}
function makeGrid(rows,lang='fi',cols,rng){const c=cols||rows;return Array.from({length:rows},()=>Array.from({length:c},()=>randLetterLang(lang,rng)));}

// Seeded PRNG for daily challenge — mulberry32
function seededRng(seed){let t=seed|0;return()=>{t=t+0x6D2B79F5|0;let x=Math.imul(t^(t>>>15),1|t);x^=x+Math.imul(x^(x>>>7),61|x);return((x^(x>>>14))>>>0)/4294967296;};}
function dailySeed(dateStr){let h=0;for(let i=0;i<dateStr.length;i++){h=Math.imul(31,h)+dateStr.charCodeAt(i)|0;}return h;}
// Daily challenge number: days since 2026-04-27
const DAILY_EPOCH=new Date('2026-04-27').getTime();
function dailyNumber(){return Math.floor((Date.now()-DAILY_EPOCH)/(1000*60*60*24))+1;}
function todayStr(){return new Date().toLocaleDateString('sv-SE',{timeZone:'Europe/Helsinki'});}
function makeDailyGrid(lang='fi'){const rng=seededRng(dailySeed(todayStr()+lang));return makeGrid(7,lang,5,rng);}

// ============================================
// DAILY THEMES — themed word lists for daily challenge
// ============================================
const DAILY_THEMES={
  fi:[
    {id:"luonto",name:"Luonto",nameEn:"Nature",nameSv:"Natur",words:["metsä","puu","lehti","kukka","joki","järvi","vuori","kivi","sammal","sieni","oksa","juuri","pilvi","sade","tuuli","lumi","jää","ruoho","niitty","taivas","aurinko","kuu","tähti","maa","vesi"]},
    {id:"eläimet",name:"Eläimet",nameEn:"Animals",nameSv:"Djur",words:["koira","kissa","lintu","kala","karhu","kettu","hirvi","jänis","orava","susi","kotka","pöllö","hevonen","lammas","lehmä","sika","ankka","kana","hiiri","käärme","sammakko","mehiläinen","perhonen"]},
    {id:"ruoka",name:"Ruoka",nameEn:"Food",nameSv:"Mat",words:["leipä","juusto","kakku","keitto","liha","kala","peruna","porkkana","omena","marja","suola","sokeri","maito","voi","muna","riisi","pasta","salaatti","piirakka","lettu","puuro","mehu","kahvi"]},
    {id:"koti",name:"Koti",nameEn:"Home",nameSv:"Hem",words:["tuoli","pöytä","sänky","ikkuna","ovi","lattia","katto","seinä","lamppu","matto","peili","kirja","kello","tyyny","peitto","lasi","kuppi","lusikka","haarukka","veitsi","astia","hylly"]},
    {id:"urheilu",name:"Urheilu",nameEn:"Sports",nameSv:"Sport",words:["pallo","maali","juoksu","hyppy","uinti","hiihto","luistelu","pyörä","joukkue","peli","ottelu","kenttä","tuomari","voitto","häviö","piste","sarja","harjoitus","valmentaja"]},
    {id:"meri",name:"Meri",nameEn:"Sea",nameSv:"Hav",words:["aalto","ranta","laiva","vene","saari","kala","lohi","rapu","simpukka","ankkuri","purje","satama","majakka","hiekka","tuuli","myrsky","valas","hylje","lokki","sumu"]},
    {id:"musiikki",name:"Musiikki",nameEn:"Music",nameSv:"Musik",words:["laulu","soitto","kitara","piano","rumpu","huilu","viulu","nuotti","melodia","rytmi","basso","sävelmä","kuoro","säveltäjä","konsertti","levy","radio","ääni"]},
    {id:"sää",name:"Sää",nameEn:"Weather",nameSv:"Väder",words:["aurinko","pilvi","sade","lumi","tuuli","myrsky","ukkonen","salama","sumu","halla","pakkanen","lämpö","jää","raekuuro","sateenkaari","kostea","kuiva"]},
    {id:"kaupunki",name:"Kaupunki",nameEn:"City",nameSv:"Stad",words:["talo","katu","silta","puisto","kauppa","koulu","kirjasto","museo","teatteri","ravintola","hotelli","kirkko","torni","asema","bussi","auto","pyörä","valo","penkki"]},
    {id:"avaruus",name:"Avaruus",nameEn:"Space",nameSv:"Rymd",words:["tähti","kuu","aurinko","planeetta","galaksi","raketti","astronautti","satelliitti","meteori","kometta","avaruus","musta","aukko","valo","pimeä","rata"]},
    {id:"puutarha",name:"Puutarha",nameEn:"Garden",nameSv:"Trädgård",words:["kukka","ruusu","puu","pensas","nurmikko","siemen","multa","kastelukanne","kukkula","omena","marja","tomaatti","kurkku","salaatti","peruna","porkkana","herne","papu"]},
    {id:"juhla",name:"Juhla",nameEn:"Party",nameSv:"Fest",words:["kakku","lahja","koriste","ilmapallo","valo","musiikki","tanssi","nauru","ystävä","perhe","juhla","kutsu","tarjoilu","juoma","konfetti","serpentiini","hattu"]},
    {id:"värit",name:"Värit",nameEn:"Colors",nameSv:"Färger",words:["punainen","sininen","vihreä","keltainen","valkoinen","musta","oranssi","violetti","ruskea","harmaa","pinkki","turkoosi","kulta","hopea","vaaleanpunainen"]},
    {id:"ammatti",name:"Ammatit",nameEn:"Professions",nameSv:"Yrken",words:["lääkäri","opettaja","kokki","poliisi","palomies","insinööri","taiteilija","muusikko","kirjailija","maanviljelijä","kauppias","sähköasentaja","putkimies"]},
    {id:"talvi",name:"Talvi",nameEn:"Winter",nameSv:"Vinter",words:["lumi","jää","pakkanen","hanki","hiihto","luistelu","pulkka","latu","suksi","lumiukko","joulu","kynttilä","takka","viltti","kaakao","pipari"]},
    {id:"kesä",name:"Kesä",nameEn:"Summer",nameSv:"Sommar",words:["aurinko","uiminen","ranta","loma","grilli","mökki","sauna","vene","kalastus","marjastus","pyöräily","jäätelö","lämmin","yötön","helle","uimaranta"]},
  ],
  en:[
    {id:"nature",name:"Nature",words:["tree","leaf","river","lake","mountain","rock","moss","cloud","rain","wind","snow","ice","grass","sky","sun","moon","star","earth","water","flower","root","branch"]},
    {id:"animals",name:"Animals",words:["dog","cat","bird","fish","bear","fox","deer","rabbit","wolf","eagle","owl","horse","sheep","cow","pig","duck","hen","mouse","snake","frog","bee"]},
    {id:"food",name:"Food",words:["bread","cheese","cake","soup","meat","fish","potato","carrot","apple","berry","salt","sugar","milk","butter","egg","rice","pasta","salad","pie","juice","coffee"]},
    {id:"home",name:"Home",words:["chair","table","bed","window","door","floor","roof","wall","lamp","rug","mirror","book","clock","pillow","glass","cup","spoon","fork","knife","shelf"]},
    {id:"sea",name:"Sea",words:["wave","beach","ship","boat","island","fish","crab","shell","anchor","sail","port","sand","wind","storm","whale","seal","gull","fog","reef","tide"]},
    {id:"city",name:"City",words:["house","street","bridge","park","shop","school","museum","hotel","church","tower","bus","car","bike","light","bench","road","train","sign","cafe"]},
    {id:"space",name:"Space",words:["star","moon","sun","planet","galaxy","rocket","orbit","comet","meteor","light","dark","void","ring","dust","probe","mars","venus"]},
    {id:"winter",name:"Winter",words:["snow","ice","frost","ski","sled","scarf","mitten","fire","candle","cocoa","cold","chill","storm","flake","icicle"]},
    {id:"summer",name:"Summer",words:["sun","swim","beach","camp","grill","cabin","boat","fish","berry","bike","warm","heat","lake","shade","wave","sand"]},
  ],
  sv:[
    {id:"natur",name:"Natur",words:["träd","löv","flod","sjö","berg","sten","moln","regn","vind","snö","is","gräs","himmel","sol","måne","stjärna","jord","vatten","blomma","rot"]},
    {id:"djur",name:"Djur",words:["hund","katt","fågel","fisk","björn","räv","älg","hare","varg","örn","uggla","häst","får","ko","gris","anka","höna","mus","orm","groda","bi"]},
    {id:"mat",name:"Mat",words:["bröd","ost","kaka","soppa","kött","fisk","potatis","morot","äpple","bär","salt","socker","mjölk","smör","ägg","ris","pasta","sallad","paj","juice","kaffe"]},
  ]
};

function getDailyTheme(dateStr,lang){
  const themes=DAILY_THEMES[lang]||DAILY_THEMES.fi;
  const rng=seededRng(dailySeed(dateStr+"theme"));
  return themes[Math.floor(rng()*themes.length)];
}

// Count how many theme words (or their inflections) are findable in a hex grid.
// Käyttää prefiksi-matchausta – jos teemasana on "kissa", taivutukset
// "kissan", "kissoja", "kissalla" lasketaan myös. Stem-pituus = 4 tai
// sanan koko pituus jos lyhyempi (esim. "puu" → "puu", löytää "puuta").
function countThemeWords(foundWords,theme){
  if(!theme||!theme.words)return 0;
  const stems=theme.words.map(w=>w.slice(0,Math.min(4,w.length)));
  const seen=new Set();
  for(const w of foundWords){
    for(const stem of stems){
      if(w.startsWith(stem)&&!seen.has(stem)){seen.add(stem);break;}
    }
  }
  return seen.size;
}
// Check if a single word matches any theme word (stem-based).
// Returns the matched stem or null.
function isThemeWord(word,theme){
  if(!theme||!theme.words)return null;
  for(const tw of theme.words){
    const stem=tw.slice(0,Math.min(4,tw.length));
    if(word.startsWith(stem))return stem;
  }
  return null;
}
const DAILY_THEME_BONUS=25; // bonus points when finding 2+ theme words
const DAILY_THEME_THRESHOLD=2; // how many theme words needed for bonus
function getDailyResult(lang='fi'){try{const d=JSON.parse(localStorage.getItem(`piilosana_daily_${lang}`)||'{}');if(d.date===todayStr())return d;return null;}catch{return null;}}
function saveDailyResult(score,wordsFound,totalWords,forDate,lang='fi'){
  const d=forDate||todayStr();
  const result={date:d,num:dailyNumberForDate(d),score,wordsFound,totalWords,lang};
  if(d===todayStr())localStorage.setItem(`piilosana_daily_${lang}`,JSON.stringify(result));
  // Save to history (last 14 days, no duplicates)
  try{let hist=JSON.parse(localStorage.getItem(`piilosana_daily_history_${lang}`)||'[]');
  hist=hist.filter(h=>h.date!==d);hist.unshift(result);
  localStorage.setItem(`piilosana_daily_history_${lang}`,JSON.stringify(hist.slice(0,14)));}catch{}
}
function getDailyHistory(lang='fi'){try{return JSON.parse(localStorage.getItem(`piilosana_daily_history_${lang}`)||'[]');}catch{return [];}}
function getDailyResultForDate(dateStr,lang='fi'){const hist=getDailyHistory(lang);return hist.find(h=>h.date===dateStr)||null;}
function getDailyStreak(lang='fi'){try{const s=JSON.parse(localStorage.getItem(`piilosana_streak_${lang}`)||'{}');return s;}catch{return{};}}
function updateDailyStreak(lang='fi'){const s=getDailyStreak(lang);const today=todayStr();const yesterday=daysAgoStr(1);if(s.lastDate===today)return s;const streak=(s.lastDate===yesterday)?(s.streak||0)+1:1;const best=Math.max(streak,s.best||0);const result={streak,best,lastDate:today};localStorage.setItem(`piilosana_streak_${lang}`,JSON.stringify(result));return result;}
// Date helpers for daily challenge UI
const WEEKDAYS_FI=["sunnuntai","maanantai","tiistai","keskiviikko","torstai","perjantai","lauantai"];
const WEEKDAYS_EN=["Sunday","Monday","Tuesday","Wednesday","Thursday","Friday","Saturday"];
const WEEKDAYS_SV=["söndag","måndag","tisdag","onsdag","torsdag","fredag","lördag"];
function dateLabel(dateStr,lang='fi'){
  const d=new Date(dateStr+"T12:00:00");
  const wd=lang==="sv"?WEEKDAYS_SV:lang==="en"?WEEKDAYS_EN:WEEKDAYS_FI;
  return{weekday:wd[d.getDay()],short:d.getDate()+"."+(d.getMonth()+1)+".",full:wd[d.getDay()]+" "+d.getDate()+"."+(d.getMonth()+1)+"."};
}
function dailyNumberForDate(dateStr){return Math.floor((new Date(dateStr+"T12:00:00").getTime()-DAILY_EPOCH)/(1000*60*60*24))+1;}
function daysAgoStr(n){const d=new Date(Date.now()-n*86400000);return d.toLocaleDateString('sv-SE',{timeZone:'Europe/Helsinki'});}
function tomorrowStr(){return daysAgoStr(-1);}

// Client-side gravity: remove cells, drop letters down, fill new from top
function applyGravityClient(grid,removedCells,lang='fi'){
  const sz=grid.length;
  const ng=grid.map(row=>[...row]);
  for(const{r,c}of removedCells)ng[r][c]=null;
  for(let c=0;c<sz;c++){
    const letters=[];
    for(let r=sz-1;r>=0;r--){if(ng[r][c]!==null)letters.push(ng[r][c]);}
    for(let r=sz-1;r>=0;r--){
      const idx=sz-1-r;
      ng[r][c]=idx<letters.length?letters[idx]:randLetterLang(lang);
    }
  }
  return ng;
}

// Rotate grid: shift a row left/right or column up/down (wrap-around)
function rotateRow(grid,row,dir){// dir: 1=right, -1=left
  const sz=grid.length;const ng=grid.map(r=>[...r]);
  for(let c=0;c<sz;c++){ng[row][(c+dir+sz)%sz]=grid[row][c];}
  return ng;
}
function rotateCol(grid,col,dir){// dir: 1=down, -1=up
  const sz=grid.length;const ng=grid.map(r=>[...r]);
  for(let r=0;r<sz;r++){ng[(r+dir+sz)%sz][col]=grid[r][col];}
  return ng;
}

// Chess piece movement rules
const CHESS_PIECES=["pawn","rook","bishop","knight","queen"];
const CHESS_EMOJI={pawn:"♟",rook:"♜",bishop:"♝",knight:"♞",queen:"♛"};
const CHESS_NAMES={
  fi:{pawn:"sotilas",rook:"torni",bishop:"lähetti",knight:"ratsu",queen:"kuningatar"},
  en:{pawn:"pawn",rook:"rook",bishop:"bishop",knight:"knight",queen:"queen"},
  sv:{pawn:"bonde",rook:"torn",bishop:"löpare",knight:"springare",queen:"dam"},
};
const CHESS_MULT={pawn:1.5,rook:1,bishop:1.5,knight:2,queen:1};
function chessValidMoves(piece,r,c,sz){
  const moves=[];
  if(piece==="knight"){
    for(const[dr,dc]of[[-2,-1],[-2,1],[-1,-2],[-1,2],[1,-2],[1,2],[2,-1],[2,1]]){
      const nr=r+dr,nc=c+dc;
      if(nr>=0&&nr<sz&&nc>=0&&nc<sz)moves.push({r:nr,c:nc});
    }
  }else if(piece==="rook"){
    for(let i=0;i<sz;i++){if(i!==r)moves.push({r:i,c});if(i!==c)moves.push({r,c:i});}
  }else if(piece==="bishop"){
    for(let d=1;d<sz;d++){
      if(r-d>=0&&c-d>=0)moves.push({r:r-d,c:c-d});
      if(r-d>=0&&c+d<sz)moves.push({r:r-d,c:c+d});
      if(r+d<sz&&c-d>=0)moves.push({r:r+d,c:c-d});
      if(r+d<sz&&c+d<sz)moves.push({r:r+d,c:c+d});
    }
  }else if(piece==="queen"){
    for(let i=0;i<sz;i++){if(i!==r)moves.push({r:i,c});if(i!==c)moves.push({r,c:i});}
    for(let d=1;d<sz;d++){
      if(r-d>=0&&c-d>=0)moves.push({r:r-d,c:c-d});
      if(r-d>=0&&c+d<sz)moves.push({r:r-d,c:c+d});
      if(r+d<sz&&c-d>=0)moves.push({r:r+d,c:c-d});
      if(r+d<sz&&c+d<sz)moves.push({r:r+d,c:c+d});
    }
  }else if(piece==="pawn"){
    // Pawn: forward (up) + diagonal captures (up-left, up-right)
    if(r-1>=0)moves.push({r:r-1,c});
    if(r-1>=0&&c-1>=0)moves.push({r:r-1,c:c-1});
    if(r-1>=0&&c+1<sz)moves.push({r:r-1,c:c+1});
  }
  return moves;
}
function randomChessPiece(){return CHESS_PIECES[Math.floor(Math.random()*CHESS_PIECES.length)];}

// Theme word categories
const WORD_THEMES={
  fi:[
    {name:"Eläimet",emoji:"🐾",words:["kissa","koira","karhu","hirvi","lintu","orava","kettu","jänis","susi","kotka","hauki","ahven","sorsa","tikka","haukka"]},
    {name:"Ruoka",emoji:"🍽️",words:["leipä","juusto","kakku","liha","kala","riisi","pasta","keitto","salaatti","peruna","tomaatti","sipuli","porkkana","omena","marja"]},
    {name:"Luonto",emoji:"🌿",words:["metsä","järvi","joki","puu","kukka","taivas","pilvi","sade","tuuli","lumi","kallio","niitty","suo","lahti","saari"]},
    {name:"Koti",emoji:"🏠",words:["tuoli","pöytä","sänky","ovi","ikkuna","lattia","seinä","katto","lampu","peili","matto","tyyny","lakana","hylly","kaappi"]},
    {name:"Keho",emoji:"🫀",words:["käsi","jalka","pää","silmä","korva","nenä","suu","sormi","polvi","olka","rinta","selkä","vatsa","sydän","luut"]},
  ],
  en:[
    {name:"Animals",emoji:"🐾",words:["cat","dog","bear","bird","fish","deer","wolf","fox","hawk","eagle","snake","mouse","frog","duck","owl"]},
    {name:"Food",emoji:"🍽️",words:["bread","cheese","cake","meat","fish","rice","pasta","soup","salad","apple","grape","lemon","peach","plum","corn"]},
    {name:"Nature",emoji:"🌿",words:["tree","lake","river","cloud","rain","wind","snow","rock","hill","field","leaf","bloom","shore","wave","sand"]},
    {name:"Home",emoji:"🏠",words:["chair","table","bed","door","wall","floor","lamp","shelf","desk","couch","rug","towel","plate","glass","cup"]},
    {name:"Body",emoji:"🫀",words:["hand","foot","head","eye","ear","nose","mouth","arm","leg","knee","back","neck","chest","heart","bone"]},
  ],
  sv:[
    {name:"Djur",emoji:"🐾",words:["katt","hund","björn","fågel","fisk","rådjur","varg","räv","hök","örn","orm","mus","groda","anka","uggla"]},
    {name:"Mat",emoji:"🍽️",words:["bröd","ost","kaka","kött","fisk","ris","soppa","sallad","äpple","druva","citron","majs","plommon","päron","banan"]},
    {name:"Natur",emoji:"🌿",words:["träd","sjö","flod","moln","regn","vind","snö","sten","kulle","fält","löv","strand","våg","sand","skog"]},
    {name:"Hem",emoji:"🏠",words:["stol","bord","säng","dörr","vägg","golv","lampa","hylla","soffa","matta","kudde","glas","kopp","skål","fat"]},
    {name:"Kropp",emoji:"🫀",words:["hand","fot","huvud","öga","öra","näsa","mun","arm","ben","knä","rygg","nacke","bröst","hjärta","blod"]},
  ],
};

// Pick random mystery cell
function pickMysteryCell(sz){return{r:Math.floor(Math.random()*sz),c:Math.floor(Math.random()*sz)};}

// Pick random bomb cell
function pickBombCell(sz){return{r:Math.floor(Math.random()*sz),c:Math.floor(Math.random()*sz)};}

// Scramble a section of the grid (for bomb explosion)
function scrambleArea(grid,centerR,centerC,radius,lang){
  const sz=grid.length;const ng=grid.map(r=>[...r]);
  for(let r=Math.max(0,centerR-radius);r<=Math.min(sz-1,centerR+radius);r++){
    for(let c=Math.max(0,centerC-radius);c<=Math.min(sz-1,centerC+radius);c++){
      ng[r][c]=randLetterLang(lang);
    }
  }
  return ng;
}

// UI translations
const T={
  fi:{
    selectMode:"VALITSE PELIMUOTO",arena:"MONINPELI",arenaDesc:"24/7 nonstop-moninpeli",arenaCta:"ETSI SANOJA",arenaWelcome:"Tervetuloa – liity peliin!",customGame:"OMA MONINPELI",customDesc:"kutsu kavereita",practice:"HARJOITTELU",practiceDesc:"yksinpeli",
    findWords:"Etsi sanoja ruudukosta!",dragHint:"VEDÄ kirjaimien yli kaikkiin suuntiin. Aikaa 2 min.",comboHint:"Löydä sanoja nopeasti putkeen = kombo ja lisäpisteet!",
    scoring:"PISTEYTYS: 3kir=1p · 4=2p · 5=4p · 6=6p · 7=10p",comboScoring:"KOMBO x2 (3+) · KOMBO x3 (5+)",words:"sanaa",
    nickname:"NIMIMERKKI",join:"LIITY",back:"TAKAISIN",exit:"POISTU",play:"PELAA",
    arenaJoinDesc:"Jatkuva peli kaikille! Liity mukaan ja etsi sanoja. Kierros kestää 2 min.",
    nextRound:"Seuraava kierros alkaa",playersInArena:"pelaajaa moninpelissä",playerInArena:"pelaaja moninpelissä",players:"pelaajaa",player:"pelaaja",
    getReady:"VALMISTAUDU",roundOver:"KIERROS PÄÄTTYI",yourScore:"PISTEESI",nextRoundIn:"Seuraava kierros",starts:"alkaa!",
    roundResults:"KIERROKSEN TULOKSET",foundWords:"LÖYDETYT SANAT",ownHighlighted:"Omat sanasi korostettu väreillä",defHint:"Klikkaa 3-kirjaimista sanaa nähdäksesi selitteen",
    missed:"JÄIVÄT LÖYTÄMÄTTÄ",missedLong:"Laudalta löytyi myös pidempiä sanoja",
    gameMode:"PELIMUOTO",classic:"KLASSINEN",battle:"TAISTELU",battleDesc:"Sanat näkyvät muille! Löydetyt kirjaimet katoavat ja uudet tippuvat ylhäältä.",
    time:"AIKA",unlimited:"RAJATON",unlimitedDesc:"Ei aikarajaa! Vaihda ruudukko kun haluat.",
    letterMult:"PISTEYTYS",letterMultBtn:"KIRJAINARVOT",letterMultDesc:"Harvinaiset kirjaimet = enemmän pisteitä! (D,Ö=7 V,J,H,Y,P,U=4 ...)",
    otherOptions:"MUUT VALINNAT",nickForHof:"NIMIMERKKI (ennätystauluun)",optional:"VAPAAEHTOINEN",scoresSaved:"Pisteesi tallennetaan nimellä",
    modeNormal:"NORMAALI",modeTetris:"PUDOTUS",tetrisDesc:"Löydetyt kirjaimet katoavat ja uudet tippuvat ylhäältä!",
    modeRotate:"PYÖRITYS",rotateDesc:"Raahaa reunoilta pyörittääksesi rivejä ja sarakkeita – kuin kuutiota! Löydä uusia sanoja.",rotateStarts:"PYÖRITYS ALKAA",rotateLabel:"PYÖRITYS",
    modeTheme:"TEEMAT",themeDesc:"Löydä teemaan kuuluvia sanoja bonuspisteillä!",themeStarts:"TEEMAT ALKAA",themeLabel:"TEEMAT",themeBonus:"TEEMABONUS",themeHint:"Teema",
    modeBomb:"POMMI",bombDesc:"Käytä tikittävä kirjain sanassa ennen kuin se räjähtää!",bombStarts:"POMMI ALKAA",bombLabel:"POMMI",bombExploded:"POMMI RÄJÄHTI!",
    modeMystery:"MYSTEERI",mysteryDesc:"Piilotettu kirjain paljastuu kun löydät sanan sen kautta!",mysteryStarts:"MYSTEERI ALKAA",mysteryLabel:"MYSTEERI",mysteryRevealed:"PALJASTETTU!",
    modeChess:"SHAKKI",chessDesc:"Liikuta shakkinappulaa ja muodosta sanoja sen liikkeen mukaan!",chessLabel:"SHAKKI",chessSubmit:"VAHVISTA",chessSkip:"OHITA",chessNewPiece:"Uusi nappula:",chessInvalidMove:"Ei mahdollinen!",
    modeHex:"HEKSA",hexDesc:"Kuusikulmaiset ruudut – 6 naapuria jokaisella! Uusia polkuja sanoille.",hexStarts:"HEKSA ALKAA",hexLabel:"HEKSA",
    waiting:"ODOTETAAN PELAAJIA",playersCount:"PELAAJAT",youTag:"SINÄ",createGame:"LUO PELI",connecting:"YHDISTETÄÄN...",
    startGame:"ALOITA PELI",waitForPlayers:"Odota, että joku liittyy peliisi...",waitForHost:"Odota, että isäntä aloittaa pelin...",
    joinGame:"LIITY PELIIN",roomCode:"HUONEKOODI",noRooms:"Ei avoimia huoneita",orJoinRoom:"tai liity koodilla",
    shareLink:"JAA LINKKI",copied:"Kopioitu!",scanToJoin:"Skannaa liittyäksesi",inviteFriends:"Kutsu kavereita:",arenaLink:"Suora linkki moninpeliin:",invitePlayer:"KUTSU PELAAJA",shareGame:"Jaa linkki peliin",
    newCustom:"UUSI OMA NETTIPELI",menu:"VALIKKO",newPractice:"UUSI HARJOITUS",backToMenu:"PALAA ALKUVALIKKOON",joinMulti:"LIITY NONSTOP-MONINPELIIN",
    daily:"PÄIVÄN PIILOSANA",dailyDesc:"sama kaikille · yksi yritys · 3 min",dailyDone:"Jo pelattu tänään!",dailyShare:"JAA TULOS",dailyCopied:"Kopioitu leikepöydälle!",dailyStreak:"Putki",dailyBest:"Paras",dailyWords:"sanaa",dailyOf:"yhteensä",dailyChallenge:"Haaste",
    results:"TULOKSET",score:"PISTEET",gameOver:"PELI PÄÄTTYI!",youWon:"VOITIT!",
    found:"LÖYDETYT",foundOf:"LÖYSIT",dragWords:"Vedä kirjaimista sanoja...",
    notValid:"Ei kelpaa",alreadyFound:"Jo löydetty",
    arenaLabel:"MONINPELI",battleLabel:"TAISTELU",tetrisLabel:"PUDOTUS",rotateLabel:"PYÖRITYS",themeLabel:"TEEMAT",bombLabel:"POMMI",mysteryLabel:"MYSTEERI",unlimitedLabel:"RAJATON",letterMultLabel:"KIRJAINARVOT",
    newLetters:"UUDET KIRJAIMET",stop:"LOPETA",
    saveAs:"TALLENNA NIMELLÄ",save:"TALLENNA",saved:"✓ Tallennettu!",saveToHof:"TALLENNA ENNÄTYSTAULULLE",
    gameStarts:"PELI ALKAA",battleStarts:"TAISTELU ALKAA",tetrisStarts:"PUDOTUS ALKAA",comboStreak:"putkeen!",
    megaCombo:"MEGA KOMBO",combo:"KOMBO",online:"online",
    openGames:"AVOIMET PELIT",roomFull:"Huone on täynnä",gameInProgress:"Peli on jo käynnissä",roomNotFound:"Huonetta ei löydy",
    someoneBeatYou:"Joku ehti ensin!",tooShort:"Liian lyhyt",notInGrid:"Ei löydy ruudukosta",wrongMode:"Väärä moodi",gameNotRunning:"Peli ei käynnissä",
    achievements:"SAAVUTUKSET",achievementUnlocked:"Uusi saavutus!",locked:"Lukittu",
    share:"JAA TULOS",shareCopied:"Kopioitu!",shareText:"Sanapiilo – löysin {words} sanaa ja sain {score} pistettä! Pääsetkö parempaan?",
    options:"ASETUKSET",quickPlay:"PELAA",or:"tai",advancedOptions:"Lisävalinnat",
    readMoreWords:"Lue lisää sanoista",
    wordInfoTitle:"SANALISTASTA",
    wordInfoBody1:"Sanalistassa on perusmuotoja, taivutuksia ja yhdyssanoja – yhteensä noin 138 000 sanaa.",
    wordInfoBody2:"Suomen kielelle sanoja on paljon, koska suomen rikas taivutusjärjestelmä tuottaa saman sanan monessa muodossa (esim. talo → taloa, talossa, talojen, taloihin...).",
    wordInfoBody3:"Sanalista perustuu Wiktionary-sanakirjaan (kaikki.org). Sanat ovat 3–7 kirjainta pitkiä.",
    wordInfoSources:"Lähteet",
    wordInfoSourceFi:"Wiktionary (kaikki.org) – perusmuodot ja taivutukset, ~138 000 sanaa",
    wordInfoSourceEn:"ENABLE – Enhanced North American Benchmark Lexicon (public domain)",
    wordInfoSourceSv:"Wiktionary (kaikki.org) – grundformer och böjningar (CC-BY-SA)",
    howToPlay:"Näin pelaat",
    helpDrag:"Vedä sormella tai hiirellä kirjainten yli muodostaaksesi sanoja. Voit liikkua kaikkiin suuntiin, myös vinottain.",
    helpTime:"Sinulla on 2 minuuttia aikaa löytää mahdollisimman monta sanaa.",
    helpScoring:"Pisteytys: 3 kirjainta = 1p · 4 = 2p · 5 = 4p · 6 = 6p · 7 = 10p · 8+ = 14p",
    helpCombo:"Löydä sanoja nopeasti peräkkäin → combo! 3+ peräkkäin = x2, 5+ = x3 pisteet.",
    helpMultiplier:"Kultaiset kirjaimet antavat 2× tai 3× pistekertoimen sanaan.",
    helpLang:"Voit vaihtaa kieltä päävalikossa. Jokaisella kielellä on oma sanavarasto – suomeksi yli 90 000 sanaa ja niiden taivutusmuotoja, yhteensä yli 6 miljoonaa muotoa (3–15 kirjainta). Englanniksi ja ruotsiksi omat sanalistansa.",
    helpInflection:"Taivutusmuodot kelpaavat! Esim. sametti → sametin, samettia, samettiin, sametilla, sametteja, samettien… Kaikki suomen sijamuodot toimivat, joten kokeile rohkeasti eri päätteitä.",
    helpInflectionLink:"Katso kaikki taivutusmuodot →",
    helpDefs:"Klikkaa lyhyitä sanoja tulosnäkymässä nähdäksesi niiden merkityksen. Selitteet löytyvät 3-kirjaimisille sanoille.",
    tutorialBtn:"PIKAOHJE",
    exitConfirm:"Poistu pelistä?",exitYes:"POISTU",exitNo:"JATKA",
    menuSound:"ÄÄNET",menuMusic:"MUSIIKKI",menuTheme:"TEEMA",menuShare:"KUTSU",menuExit:"POISTU",on:"PÄÄLLÄ",off:"POIS",
    menuExitGame:"POISTU PELISTÄ",menuClose:"SULJE VALIKKO",menuMuteEmoji:"VAIMENNA ELEET",
  },
  en:{
    selectMode:"SELECT GAME MODE",arena:"MULTIPLAYER",arenaDesc:"24/7 online game",arenaCta:"FIND WORDS",arenaWelcome:"Welcome — join the game!",customGame:"CUSTOM GAME",customDesc:"various modes",practice:"PRACTICE",practiceDesc:"solo play",
    findWords:"Find words from the grid!",dragHint:"DRAG across letters in all directions. 2 min timer.",comboHint:"Find words quickly in a row = combo and bonus points!",
    scoring:"SCORING: 3let=1p · 4=2p · 5=4p · 6=6p · 7=10p",comboScoring:"COMBO x2 (3+) · COMBO x3 (5+)",words:"words",
    nickname:"NICKNAME",join:"JOIN",back:"BACK",exit:"EXIT",play:"PLAY",
    arenaJoinDesc:"Continuous game for everyone! Join in and find words. Round lasts 2 min.",
    nextRound:"Next round starts",playersInArena:"playing",playerInArena:"playing",players:"players",player:"player",
    getReady:"GET READY",roundOver:"ROUND OVER",yourScore:"YOUR SCORE",nextRoundIn:"Next round",starts:"starting!",
    roundResults:"ROUND RESULTS",foundWords:"FOUND WORDS",ownHighlighted:"Your words highlighted in color",defHint:"Tap a 3-letter word to see its definition",
    missed:"NOT FOUND",missedLong:"The board also had longer words",
    gameMode:"GAME MODE",classic:"CLASSIC",battle:"BATTLE",battleDesc:"Words visible to others! Found letters disappear and new ones drop from above.",
    time:"TIME",unlimited:"UNLIMITED",unlimitedDesc:"No time limit! Change grid whenever you want.",
    letterMult:"SCORING",letterMultBtn:"LETTER VALUES",letterMultDesc:"Rare letters = more points! (Q,Z=10 J,X=8 K=5 ...)",
    otherOptions:"OTHER OPTIONS",nickForHof:"NICKNAME (for leaderboard)",optional:"OPTIONAL",scoresSaved:"Your score will be saved as",
    modeNormal:"NORMAL",modeTetris:"DROP",tetrisDesc:"Found letters disappear and new ones drop from above!",
    modeRotate:"ROTATE",rotateDesc:"Drag edges to rotate rows and columns — like a cube! Find new words.",rotateStarts:"ROTATE STARTS",rotateLabel:"ROTATE",
    modeTheme:"THEMES",themeDesc:"Find themed words for bonus points!",themeStarts:"THEMES START",themeLabel:"THEMES",themeBonus:"THEME BONUS",themeHint:"Theme",
    modeBomb:"BOMB",bombDesc:"Use the ticking letter in a word before it explodes!",bombStarts:"BOMB STARTS",bombLabel:"BOMB",bombExploded:"BOMB EXPLODED!",
    modeMystery:"MYSTERY",mysteryDesc:"A hidden letter is revealed when you find a word through it!",mysteryStarts:"MYSTERY STARTS",mysteryLabel:"MYSTERY",mysteryRevealed:"REVEALED!",
    modeChess:"CHESS",chessDesc:"Move a chess piece and form words following its movement rules!",chessLabel:"CHESS",chessSubmit:"SUBMIT",chessSkip:"SKIP",chessNewPiece:"New piece:",chessInvalidMove:"Not possible!",
    modeHex:"HEX",hexDesc:"Hexagonal cells — 6 neighbors each! New paths for words.",hexStarts:"HEX STARTS",hexLabel:"HEX",
    waiting:"WAITING FOR PLAYERS",playersCount:"PLAYERS",youTag:"YOU",createGame:"CREATE GAME",connecting:"CONNECTING...",
    startGame:"START GAME",waitForPlayers:"Wait for someone to join...",waitForHost:"Waiting for host to start...",
    joinGame:"JOIN GAME",roomCode:"ROOM CODE",noRooms:"No open rooms",orJoinRoom:"or join with code",
    shareLink:"SHARE LINK",copied:"Copied!",scanToJoin:"Scan to join",inviteFriends:"Invite friends:",arenaLink:"Direct link to multiplayer:",invitePlayer:"INVITE PLAYER",shareGame:"Share game link",
    newCustom:"NEW CUSTOM GAME",menu:"MENU",newPractice:"NEW PRACTICE",backToMenu:"BACK TO MENU",joinMulti:"JOIN NONSTOP MULTIPLAYER",
    daily:"DAILY CHALLENGE",dailyDesc:"same for everyone · one attempt · 3 min",dailyDone:"Already played today!",dailyShare:"SHARE RESULT",dailyCopied:"Copied to clipboard!",dailyStreak:"Streak",dailyBest:"Best",dailyWords:"words",dailyOf:"total",dailyChallenge:"Challenge",
    results:"RESULTS",score:"SCORE",gameOver:"GAME OVER!",youWon:"YOU WON!",
    found:"FOUND",foundOf:"YOU FOUND",dragWords:"Drag across letters to find words...",
    notValid:"Not valid",alreadyFound:"Already found",
    arenaLabel:"MULTIPLAYER",battleLabel:"BATTLE",tetrisLabel:"DROP",rotateLabel:"ROTATE",themeLabel:"THEMES",bombLabel:"BOMB",mysteryLabel:"MYSTERY",unlimitedLabel:"UNLIMITED",letterMultLabel:"LETTER VALUES",
    newLetters:"NEW LETTERS",stop:"STOP",
    saveAs:"SAVE AS",save:"SAVE",saved:"✓ Saved!",saveToHof:"SAVE TO LEADERBOARD",
    gameStarts:"GAME STARTS",battleStarts:"BATTLE STARTS",tetrisStarts:"DROP STARTS",comboStreak:"in a row!",
    megaCombo:"MEGA COMBO",combo:"COMBO",online:"online",
    openGames:"OPEN GAMES",roomFull:"Room is full",gameInProgress:"Game already in progress",roomNotFound:"Room not found",
    someoneBeatYou:"Someone got it first!",tooShort:"Too short",notInGrid:"Not found in grid",wrongMode:"Wrong mode",gameNotRunning:"Game not running",
    achievements:"ACHIEVEMENTS",achievementUnlocked:"New achievement!",locked:"Locked",
    share:"SHARE",shareCopied:"Copied!",shareText:"Sanapiilo — I found {words} words and scored {score} points! Can you beat me?",
    options:"SETTINGS",quickPlay:"PLAY",or:"or",advancedOptions:"More options",
    readMoreWords:"Read more about the words",
    wordInfoTitle:"ABOUT THE WORD LIST",
    wordInfoBody1:"The word list includes base forms, inflections and compound words — about 138,000 words in total.",
    wordInfoBody2:"The Finnish list is especially large because Finnish has a rich inflection system that produces many forms of each word (e.g. talo → taloa, talossa, talojen, taloihin...).",
    wordInfoBody3:"The word list is based on the Wiktionary dictionary (kaikki.org). Words are 3–7 letters long.",
    wordInfoSources:"Sources",
    wordInfoSourceFi:"Wiktionary (kaikki.org) — base forms and inflections, ~138,000 words",
    wordInfoSourceEn:"ENABLE — Enhanced North American Benchmark Lexicon (public domain)",
    wordInfoSourceSv:"SAOL — Swedish Academy Glossary",
    howToPlay:"How to play",
    helpDrag:"Drag your finger or mouse across letters to form words. You can move in all directions, including diagonally.",
    helpTime:"You have 2 minutes to find as many words as possible.",
    helpScoring:"Scoring: 3 letters = 1pt · 4 = 2pt · 5 = 4pt · 6 = 6pt · 7 = 10pt · 8+ = 14pt",
    helpCombo:"Find words quickly in a row → combo! 3+ in a row = x2, 5+ = x3 points.",
    helpMultiplier:"Golden letters give a 2× or 3× score multiplier for the word.",
    helpLang:"You can switch language from the main menu. Each language has its own word list — Finnish has over 90,000 words and their inflections, totaling over 6 million forms (3–15 letters). English and Swedish have their own vocabularies.",
    helpInflection:"Inflected forms count! E.g. velvet → sametin, samettia, samettiin, sametilla, sametteja… All Finnish case forms work, so try different endings boldly.",
    helpInflectionLink:"See all inflection forms →",
    helpDefs:"Tap short words in the results screen to see their meaning. Definitions are available for 3-letter words.",
    tutorialBtn:"QUICK GUIDE",
    exitConfirm:"Quit the game?",exitYes:"QUIT",exitNo:"CONTINUE",
    menuSound:"SOUNDS",menuMusic:"MUSIC",menuTheme:"THEME",menuShare:"INVITE",menuExit:"EXIT",on:"ON",off:"OFF",
    menuExitGame:"EXIT GAME",menuClose:"CLOSE MENU",menuMuteEmoji:"MUTE GESTURES",
  },
  sv:{
    selectMode:"VÄLJ SPELLÄGE",arena:"FLERSPELARE",arenaDesc:"24/7 onlinespel",arenaCta:"HITTA ORD",arenaWelcome:"Välkommen – gå med i spelet!",customGame:"EGET SPEL",customDesc:"olika lägen",practice:"ÖVNING",practiceDesc:"ensam",
    findWords:"Hitta ord i rutnätet!",dragHint:"DRA över bokstäverna i alla riktningar. 2 min tid.",comboHint:"Hitta ord snabbt i rad = kombo och bonuspoäng!",
    scoring:"POÄNG: 3bok=1p · 4=2p · 5=4p · 6=6p · 7=10p",comboScoring:"KOMBO x2 (3+) · KOMBO x3 (5+)",words:"ord",
    nickname:"SMEKNAMN",join:"GÅ MED",back:"TILLBAKA",exit:"LÄMNA",play:"SPELA",
    arenaJoinDesc:"Löpande spel för alla! Gå med och hitta ord. Rundan varar 2 min.",
    nextRound:"Nästa runda börjar",playersInArena:"spelar",playerInArena:"spelar",players:"spelare",player:"spelare",
    getReady:"GÖR DIG REDO",roundOver:"RUNDAN SLUT",yourScore:"DINA POÄNG",nextRoundIn:"Nästa runda",starts:"börjar!",
    roundResults:"RUNDANS RESULTAT",foundWords:"HITTADE ORD",ownHighlighted:"Dina ord markerade i färg",defHint:"Tryck på ett 3-bokstavsord för att se definitionen",
    missed:"INTE HITTADE",missedLong:"Det fanns också längre ord på brädet",
    gameMode:"SPELLÄGE",classic:"KLASSISKT",battle:"STRID",battleDesc:"Ord syns för andra! Hittade bokstäver försvinner och nya faller uppifrån.",
    time:"TID",unlimited:"OBEGRÄNSAD",unlimitedDesc:"Ingen tidsgräns! Byt rutnät när du vill.",
    letterMult:"POÄNGSÄTTNING",letterMultBtn:"BOKSTAVSVÄRDEN",letterMultDesc:"Ovanliga bokstäver = mer poäng! (Z=10 X=8 J=7 ...)",
    otherOptions:"ANDRA VAL",nickForHof:"SMEKNAMN (för topplistan)",optional:"VALFRITT",scoresSaved:"Dina poäng sparas som",
    modeNormal:"NORMAL",modeTetris:"FALL",tetrisDesc:"Hittade bokstäver försvinner och nya faller uppifrån!",
    modeRotate:"ROTERA",rotateDesc:"Dra i kanterna för att rotera rader och kolumner – som en kub! Hitta nya ord.",rotateStarts:"ROTERA BÖRJAR",rotateLabel:"ROTERA",
    modeTheme:"TEMAN",themeDesc:"Hitta temaord för bonuspoäng!",themeStarts:"TEMAN BÖRJAR",themeLabel:"TEMAN",themeBonus:"TEMABONUS",themeHint:"Tema",
    modeBomb:"BOMB",bombDesc:"Använd den tickande bokstaven i ett ord innan den exploderar!",bombStarts:"BOMB BÖRJAR",bombLabel:"BOMB",bombExploded:"BOMBEN EXPLODERADE!",
    modeMystery:"MYSTERIUM",mysteryDesc:"En dold bokstav avslöjas när du hittar ett ord genom den!",mysteryStarts:"MYSTERIUM BÖRJAR",mysteryLabel:"MYSTERIUM",mysteryRevealed:"AVSLÖJAD!",
    modeChess:"SCHACK",chessDesc:"Flytta en schackpjäs och bilda ord efter dess rörelseregler!",chessLabel:"SCHACK",chessSubmit:"BEKRÄFTA",chessSkip:"HOPPA ÖVER",chessNewPiece:"Ny pjäs:",chessInvalidMove:"Inte möjligt!",
    modeHex:"HEXA",hexDesc:"Hexagonala rutor – 6 grannar var! Nya vägar för ord.",hexStarts:"HEXA BÖRJAR",hexLabel:"HEXA",
    waiting:"VÄNTAR PÅ SPELARE",playersCount:"SPELARE",youTag:"DU",createGame:"SKAPA SPEL",connecting:"ANSLUTER...",
    startGame:"STARTA SPEL",waitForPlayers:"Vänta tills någon går med...",waitForHost:"Väntar på att värden startar...",
    joinGame:"GÅ MED I SPEL",roomCode:"RUMSKOD",noRooms:"Inga öppna rum",orJoinRoom:"eller gå med via kod",
    shareLink:"DELA LÄNK",copied:"Kopierat!",scanToJoin:"Skanna för att gå med",inviteFriends:"Bjud in vänner:",arenaLink:"Direktlänk till flerspelare:",invitePlayer:"BJUD IN SPELARE",shareGame:"Dela spellänk",
    newCustom:"NYTT EGET SPEL",menu:"MENY",newPractice:"NY ÖVNING",backToMenu:"TILLBAKA TILL MENYN",joinMulti:"GÅ MED I NONSTOP-FLERSPEL",
    daily:"DAGENS UTMANING",dailyDesc:"samma för alla · ett försök · 3 min",dailyDone:"Redan spelat idag!",dailyShare:"DELA RESULTAT",dailyCopied:"Kopierat till urklipp!",dailyStreak:"Svit",dailyBest:"Bästa",dailyWords:"ord",dailyOf:"totalt",dailyChallenge:"Utmaning",
    results:"RESULTAT",score:"POÄNG",gameOver:"SPELET SLUT!",youWon:"DU VANN!",
    found:"HITTADE",foundOf:"DU HITTADE",dragWords:"Dra över bokstäver för att hitta ord...",
    notValid:"Ogiltigt",alreadyFound:"Redan hittat",
    arenaLabel:"FLERSPELARE",battleLabel:"STRID",tetrisLabel:"FALL",rotateLabel:"ROTERA",themeLabel:"TEMAN",bombLabel:"BOMB",mysteryLabel:"MYSTERIUM",unlimitedLabel:"OBEGRÄNSAD",letterMultLabel:"BOKSTAVSVÄRDEN",
    newLetters:"NYA BOKSTÄVER",stop:"STOPPA",
    saveAs:"SPARA SOM",save:"SPARA",saved:"✓ Sparat!",saveToHof:"SPARA TILL TOPPLISTAN",
    gameStarts:"SPELET BÖRJAR",battleStarts:"STRIDEN BÖRJAR",tetrisStarts:"FALL BÖRJAR",comboStreak:"i rad!",
    megaCombo:"MEGA KOMBO",combo:"KOMBO",online:"online",
    openGames:"ÖPPNA SPEL",roomFull:"Rummet är fullt",gameInProgress:"Spelet pågår redan",roomNotFound:"Rummet hittades inte",
    someoneBeatYou:"Någon hann före!",tooShort:"För kort",notInGrid:"Finns inte i rutnätet",wrongMode:"Fel läge",gameNotRunning:"Spelet är inte igång",
    achievements:"PRESTATIONER",achievementUnlocked:"Ny prestation!",locked:"Låst",
    share:"DELA",shareCopied:"Kopierat!",shareText:"Sanapiilo – jag hittade {words} ord och fick {score} poäng! Kan du slå mig?",
    options:"INSTÄLLNINGAR",quickPlay:"SPELA",or:"eller",advancedOptions:"Fler alternativ",
    readMoreWords:"Läs mer om orden",
    wordInfoTitle:"OM ORDLISTAN",
    wordInfoBody1:"Ordlistan innehåller grundformer, böjningar och sammansatta ord – totalt cirka 138 000 ord.",
    wordInfoBody2:"Den finska listan är särskilt stor eftersom finska har ett rikt böjningssystem som ger många former av varje ord (t.ex. talo → taloa, talossa, talojen, taloihin...).",
    wordInfoBody3:"Ordlistan baseras på Wiktionary (kaikki.org). Orden är 3–7 bokstäver långa.",
    wordInfoSources:"Källor",
    wordInfoSourceFi:"Wiktionary (kaikki.org) – grundformer och böjningar, ~138 000 ord",
    wordInfoSourceEn:"ENABLE – Enhanced North American Benchmark Lexicon (public domain)",
    wordInfoSourceSv:"Wiktionary (kaikki.org) – grundformer och böjningar (CC-BY-SA)",
    howToPlay:"Så spelar du",
    helpDrag:"Dra fingret eller musen över bokstäver för att bilda ord. Du kan röra dig i alla riktningar, även diagonalt.",
    helpTime:"Du har 2 minuter på dig att hitta så många ord som möjligt.",
    helpScoring:"Poäng: 3 bokstäver = 1p · 4 = 2p · 5 = 4p · 6 = 6p · 7 = 10p · 8+ = 14p",
    helpCombo:"Hitta ord snabbt i rad → kombo! 3+ i rad = x2, 5+ = x3 poäng.",
    helpMultiplier:"Gyllene bokstäver ger 2× eller 3× poängmultiplikator för ordet.",
    helpLang:"Du kan byta språk från huvudmenyn. Varje språk har sin egen ordlista – finska har över 90 000 ord och deras böjningsformer, totalt över 6 miljoner former (3–15 bokstäver). Engelska och svenska har egna vokabulär.",
    helpInflection:"Böjningsformer räknas! T.ex. sammet → sammeten, sammets, sammeterna… Prova olika ändelser.",
    helpInflectionLink:"Se alla böjningsformer →",
    helpDefs:"Tryck på korta ord i resultatvyn för att se deras betydelse. Definitioner finns för 3-bokstavsord.",
    tutorialBtn:"SNABBGUIDE",
    exitConfirm:"Avsluta spelet?",exitYes:"AVSLUTA",exitNo:"FORTSÄTT",
    menuSound:"LJUD",menuMusic:"MUSIK",menuTheme:"TEMA",menuShare:"BJUD IN",menuExit:"AVSLUTA",on:"PÅ",off:"AV",
    menuExitGame:"AVSLUTA SPELET",menuClose:"STÄNG MENYN",menuMuteEmoji:"TYSTA GESTER",
  },
};

function findWords(grid,trie){
  const sz=grid.length,found=new Set(),dirs=[[-1,0],[1,0],[0,-1],[0,1],[-1,-1],[-1,1],[1,-1],[1,1]];
  function dfs(r,c,node,path,vis){const ch=grid[r][c],nx=node.c[ch];if(!nx)return;const np=path+ch;if(nx.w&&np.length>=3)found.add(np);vis.add(r*sz+c);for(const[dr,dc]of dirs){const nr=r+dr,nc=c+dc;if(nr>=0&&nr<sz&&nc>=0&&nc<sz&&!vis.has(nr*sz+nc))dfs(nr,nc,nx,np,vis);}vis.delete(r*sz+c);}
  for(let r=0;r<sz;r++)for(let c=0;c<sz;c++)dfs(r,c,trie,"",new Set());return found;
}

// Hex grid utilities (6-neighbor hexagonal grid, odd-r offset)
const HEX_DIRS_EVEN=[[-1,-1],[-1,0],[0,-1],[0,1],[1,-1],[1,0]];
const HEX_DIRS_ODD=[[-1,0],[-1,1],[0,-1],[0,1],[1,0],[1,1]];
function hexNeighbors(r,c,rows,cols){const dirs=r%2===0?HEX_DIRS_EVEN:HEX_DIRS_ODD;return dirs.map(([dr,dc])=>({r:r+dr,c:c+dc})).filter(n=>n.r>=0&&n.r<rows&&n.c>=0&&n.c<cols);}
function findWordsHex(grid,trie){
  const rows=grid.length,cols=grid[0].length,found=new Set();
  function dfs(r,c,node,path,vis){const ch=grid[r][c],nx=node.c[ch];if(!nx)return;const np=path+ch;if(nx.w&&np.length>=3)found.add(np);vis.add(r*cols+c);for(const n of hexNeighbors(r,c,rows,cols)){if(!vis.has(n.r*cols+n.c))dfs(n.r,n.c,nx,np,vis);}vis.delete(r*cols+c);}
  for(let r=0;r<rows;r++)for(let c=0;c<cols;c++)dfs(r,c,trie,"",new Set());return found;
}
function adjHex(a,b){const dirs=a.r%2===0?HEX_DIRS_EVEN:HEX_DIRS_ODD;return dirs.some(([dr,dc])=>a.r+dr===b.r&&a.c+dc===b.c);}

function pts(len){if(len<=2)return 0;if(len===3)return 1;if(len===4)return 2;if(len===5)return 4;if(len===6)return 6;if(len===7)return 10;return 14;}

// Letter values and colors are now per-language, resolved in component via lang state
const LETTER_VALUE_COLORS={1:"#88bbcc",2:"#44ccdd",3:"#ffbb44",4:"#ff8833",5:"#ff6655",7:"#ff4466",8:"#ff4466",10:"#ff2244"};
function getLetterValues(lang){return getLangConf(lang).letterValues;}
function ptsLetters(word,lang='fi'){const lv=getLetterValues(lang);let s=0;for(const ch of word)s+=(lv[ch]||1);return s;}
function letterColor(ch,lang='fi'){const lv=getLetterValues(lang);return LETTER_VALUE_COLORS[lv[ch]||1]||"#88bbcc";}

const fontCSS=`@import url('https://fonts.googleapis.com/css2?family=Press+Start+2P&family=VT323&family=Inter:wght@400;500;600;700&display=swap');`;

// ============================================
// THEMES
// ============================================
const MODERN_BASE={
  font:"-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif",
  cellRadius:"10px",btnRadius:"10px",
  cellShadow:"inset 0 1px 4px #00000060, 0 2px 8px #00000030",
  btnShadow:"0 4px 16px #00000040",
  cellGradient:true,
  panelRadius:"12px",panelShadow:"0 8px 32px #00000055",
  titleFont:"-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif",
  gridGap:"6px",
  letterFont:"-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif",
};
const THEMES={
  light:{
    name:"VAALEA",nameEn:"LIGHT",nameSv:"LJUS",
    bg:"#faf8f4",green:"#2d6a4f",yellow:"#7a6408",red:"#c0392b",purple:"#6c5ce7",
    dark:"#f0ece4",border:"#d4cbbf",cell:"#ffffff",cellBorder:"#e0d8ce",
    gridBg:"#f5f0e8",textMuted:"#8b7e6e",textSoft:"#5c4f3d",
    inputBg:"#ffffff",
    cellText:"#6b6050",cellTextSel:"#ffffff",
    btnYellowBg:"#8b7209",btnYellowShadow:"#5c4b06",
    ...MODERN_BASE,
    cellShadow:"inset 0 1px 3px #00000012, 0 1px 4px #00000008",
    panelShadow:"0 4px 16px #00000012",
    flavor:"ivory",
  },
  dark:{
    name:"TUMMA",nameEn:"DARK",nameSv:"MÖRK",
    bg:"#12101a",green:"#b39ddb",yellow:"#f0c674",red:"#ef5350",purple:"#ce93d8",
    dark:"#1c1828",border:"#342e48",cell:"#1c1828",cellBorder:"#3e3658",
    gridBg:"#0e0c16",textMuted:"#7e6fa0",textSoft:"#c4b5e0",
    inputBg:"#0e0c16",
    ...MODERN_BASE,
    flavor:"velvet",
  },
  pink:{
    name:"PINK DREAM",nameEn:"PINK DREAM",nameSv:"PINK DREAM",
    bg:"#fff0f5",green:"#d6336c",yellow:"#e64980",red:"#c2255c",purple:"#be4bdb",
    dark:"#ffe0ec",border:"#f0a0c0",cell:"#fff5f8",cellBorder:"#f5b8d0",
    gridBg:"#ffe8f0",textMuted:"#d0709a",textSoft:"#b03060",
    inputBg:"#fff5f8",
    cellText:"#b05078",cellTextSel:"#ffffff",
    btnYellowBg:"#e64980",btnYellowShadow:"#c2255c",
    ...MODERN_BASE,
    cellShadow:"inset 0 1px 3px #ff80b020, 0 1px 4px #ff80b010",
    panelShadow:"0 4px 16px #ff80b018",
    flavor:"dream",
  },
  electric:{
    name:"ELECTRIC BLUE",nameEn:"ELECTRIC BLUE",nameSv:"ELECTRIC BLUE",
    bg:"#000814",green:"#00f0ff",yellow:"#7dff3a",red:"#ff2050",purple:"#6090ff",
    dark:"#001228",border:"#0050aa",cell:"#001030",cellBorder:"#0060cc",
    gridBg:"#000610",textMuted:"#2890dd",textSoft:"#50d0ff",
    inputBg:"#000a18",
    ...MODERN_BASE,
    cellShadow:"inset 0 1px 4px #00a0ff30, 0 2px 8px #00a0ff15",
    panelShadow:"0 8px 32px #0080ff20",
    flavor:"electric",
  },
  retro:{
    name:"RETRO",nameEn:"RETRO",nameSv:"RETRO",
    bg:"#0a0a1a",green:"#00ff88",yellow:"#ffcc00",red:"#ff4444",purple:"#ff66ff",
    dark:"#0d0d22",border:"#334",cell:"#1a1a3a",cellBorder:"#2a2a4a",
    font:"'Press Start 2P',monospace",
    gridBg:"#111133",textMuted:"#556",textSoft:"#88ccaa",
    inputBg:"#0d0d22",
    flavor:"retro",
  },
};
function getTheme(id){
  const t=THEMES[id]||THEMES.dark;
  return {
    cellRadius:"0px",btnRadius:"0px",cellShadow:"none",btnShadow:"none",
    cellGradient:false,panelRadius:"0px",panelShadow:"none",
    titleFont:t.font,gridGap:"0px",letterFont:"'VT323',monospace",
    ...t
  };
}

// ============================================
// ENDINGS - 10 different game over animations
// ============================================
const ENDINGS = [
  { name:"LUMIMONSTERI", emoji:"⛄", color:"#6688ff",
    desc:"Lumimonsteri syö kirjaimet!",
    cellAnim:(i,total)=>`cellShrinkSpin 0.48s ${i*0.05}s ease forwards`,
    cellColor:(i)=>"#6688ff",
    overlay:(progress)=>({
      bg:"radial-gradient(circle at 50% 50%, #6688ff22 0%, transparent 70%)",
      text:progress>0.3?"NAM NAM!":"",
      textColor:"#aaccff",
      particles:Array.from({length:20},(_,i)=>({x:Math.random()*100,y:Math.random()*100,size:3+Math.random()*5,color:"white",opacity:0.3+Math.random()*0.5}))
    })
  },
  { name:"TULVA", emoji:"🌊", color:"#4488ff",
    desc:"Vesi nousee ja huuhtoo kirjaimet!",
    cellAnim:(i,total)=>{const row=Math.floor(i/5);const delay=(4-row)*0.12;return `cellFloat 0.6s ${delay}s ease forwards`;},
    cellColor:(i)=>"#4488ff",
    overlay:(progress)=>({
      bg:`linear-gradient(to top, #2244aa${Math.floor(progress*200).toString(16).padStart(2,'0')} 0%, transparent ${Math.min(100,progress*120)}%)`,
      text:progress>0.5?"TULVA!":"",textColor:"#88bbff",
      particles:Array.from({length:12},(_,i)=>({x:Math.random()*100,y:100-progress*100+Math.random()*30,size:2+Math.random()*4,color:"#88ccff",opacity:0.4}))
    })
  },
  { name:"RÄJÄHDYS", emoji:"💥", color:"#ff6622",
    desc:"Ruudukko räjähtää!",
    cellAnim:(i,total)=>{const r=Math.floor(i/5)-2,c=i%5-2;const dist=Math.sqrt(r*r+c*c);return `cellExplode 0.48s ${dist*0.07}s ease forwards`;},
    cellColor:(i)=>"#ff6622",
    overlay:(progress)=>({
      bg:progress<0.3?`radial-gradient(circle at 50% 50%, #ff662266 0%, #ff220022 50%, transparent 70%)`:"transparent",
      text:progress>0.2?"BOOM!":"",textColor:"#ff8844",
      particles:Array.from({length:25},(_,i)=>({x:50+((Math.random()-0.5)*progress*200),y:50+((Math.random()-0.5)*progress*200),size:2+Math.random()*6,color:Math.random()>0.5?"#ff6622":"#ffcc00",opacity:Math.max(0,1-progress)}))
    })
  },
  { name:"TULIPALO", emoji:"🔥", color:"#ff4400",
    desc:"Tuli polttaa ruudukon!",
    cellAnim:(i,total)=>{const r=Math.floor(i/5),c=i%5;const edge=Math.min(r,c,4-r,4-c);return `cellBurn 0.48s ${edge*0.15}s ease forwards`;},
    cellColor:(i)=>["#ff4400","#ff6600","#ffaa00","#ff8800"][i%4],
    overlay:(progress)=>({
      bg:`linear-gradient(to top, #ff440033 0%, #ff880011 ${progress*60}%, transparent ${progress*100}%)`,
      text:progress>0.4?"ROIHU!":"",textColor:"#ff8844",
      particles:Array.from({length:20},(_,i)=>({x:10+Math.random()*80,y:100-Math.random()*progress*120,size:3+Math.random()*6,color:Math.random()>0.5?"#ff6600":"#ffcc00",opacity:0.5+Math.random()*0.3}))
    })
  },
  { name:"MUSTA AUKKO", emoji:"🕳️", color:"#8844cc",
    desc:"Musta aukko imee kirjaimet!",
    cellAnim:(i,total)=>{const r=Math.floor(i/5)-2,c=i%5-2;const dist=Math.sqrt(r*r+c*c);return `cellVortex 0.72s ${(3-dist)*0.12}s ease forwards`;},
    cellColor:(i)=>"#8844cc",
    overlay:(progress)=>({
      bg:`radial-gradient(circle at 50% 50%, #000000 ${progress*15}%, #8844cc22 ${progress*30}%, transparent 60%)`,
      text:progress>0.5?"WOOOOSH":"",textColor:"#aa66ff",
      particles:Array.from({length:15},(_,i)=>({x:50+Math.cos(i+progress*10)*30*(1-progress),y:50+Math.sin(i+progress*10)*30*(1-progress),size:2+Math.random()*3,color:"#aa66ff",opacity:0.5}))
    })
  },
  { name:"UFO", emoji:"🛸", color:"#44ff88",
    desc:"Avaruusolennot ryöstävät kirjaimet!",
    cellAnim:(i,total)=>`cellBeamUp 0.48s ${i*0.05}s ease forwards`,
    cellColor:(i)=>"#44ff88",
    overlay:(progress)=>({
      bg:`linear-gradient(to bottom, #44ff8811 0%, transparent 30%)`,
      text:progress>0.3?"BZZZT!":"",textColor:"#44ff88",
      particles:Array.from({length:10},(_,i)=>({x:30+Math.random()*40,y:Math.random()*progress*60,size:1+Math.random()*3,color:"#88ffaa",opacity:0.6}))
    })
  },
  { name:"TORNADO", emoji:"🌪️", color:"#aabbcc",
    desc:"Pyörremyrsky pyyhkäisee!",
    cellAnim:(i,total)=>`cellTornado 0.6s ${i*0.04}s ease forwards`,
    cellColor:(i)=>"#aabbcc",
    overlay:(progress)=>({
      bg:"transparent",
      text:progress>0.3?"WHOOOOSH!":"",textColor:"#ccddee",
      particles:Array.from({length:20},(_,i)=>({x:50+Math.cos(i*0.8+progress*15)*40*progress,y:50+Math.sin(i*0.8+progress*15)*40*progress,size:2+Math.random()*4,color:"#aabbcc",opacity:0.4}))
    })
  },
  { name:"PAKKANEN", emoji:"❄️", color:"#88ddff",
    desc:"Pakkanen jäädyttää ja särkee!",
    cellAnim:(i,total)=>`cellFreeze 0.6s ${Math.random()*0.42}s ease forwards`,
    cellColor:(i)=>"#88ddff",
    overlay:(progress)=>({
      bg:`linear-gradient(135deg, #88ddff11 0%, #ffffff08 50%, #88ddff11 100%)`,
      text:progress>0.4?"KRRK!":"",textColor:"#aaeeff",
      particles:Array.from({length:25},(_,i)=>({x:Math.random()*100,y:Math.random()*100,size:1+Math.random()*4,color:"white",opacity:0.3+Math.random()*0.5}))
    })
  },
  { name:"LOHIKÄÄRME", emoji:"🐉", color:"#ff4466",
    desc:"Lohikäärme puhaltaa tulta!",
    cellAnim:(i,total)=>{const c=i%5;return `cellDragonFire 0.48s ${c*0.09}s ease forwards`;},
    cellColor:(i)=>["#ff2200","#ff6600","#ffaa00","#ff4400","#ff8800"][i%5],
    overlay:(progress)=>({
      bg:progress>0.2?`linear-gradient(to right, #ff440033 0%, #ff880011 50%, transparent 100%)`:"transparent",
      text:progress>0.3?"ROOAR!":"",textColor:"#ff6644",
      particles:Array.from({length:15},(_,i)=>({x:progress*120-20+Math.random()*30,y:30+Math.random()*40,size:3+Math.random()*5,color:Math.random()>0.5?"#ff4400":"#ffaa00",opacity:0.5}))
    })
  },
  { name:"GLITCH", emoji:"👾", color:"#00ff00",
    desc:"Järjestelmävirhe!",
    cellAnim:(i,total)=>`cellGlitch 0.36s ${Math.random()*0.48}s steps(4) forwards`,
    cellColor:(i)=>["#ff0000","#00ff00","#0000ff","#ff00ff","#00ffff"][i%5],
    overlay:(progress)=>({
      bg:"transparent",
      text:progress>0.2?(Math.random()>0.5?"ERR0R!":"SY5T3M FA1L"):"",textColor:"#00ff00",
      particles:Array.from({length:8},(_,i)=>({x:Math.random()*100,y:Math.random()*100,size:Math.random()*100,color:`#${Math.floor(Math.random()*16777215).toString(16)}`,opacity:0.1+Math.random()*0.2}))
    })
  },
  { name:"SULJETTU", emoji:"🚪", color:"#8b6914",
    desc:"Putiikki menee kiinni!",
    cellAnim:(i,total)=>{const c=i%5;const fromLeft=c;const fromRight=4-c;const delay=Math.min(fromLeft,fromRight)*0.12;return `cellShutterClose 0.5s ${delay}s ease-in forwards`;},
    cellColor:(i)=>"#5c3a0a",
    overlay:(progress)=>({
      bg:`linear-gradient(to right, #3a2208${Math.floor(Math.min(1,progress*1.5)*200).toString(16).padStart(2,'0')} 0%, transparent ${Math.max(0,50-progress*50)}%, transparent ${Math.min(100,50+progress*50)}%, #3a2208${Math.floor(Math.min(1,progress*1.5)*200).toString(16).padStart(2,'0')} 100%)`,
      text:progress>0.3?"SULJETTU!":"",textColor:"#d4a832",
      particles:[]
    })
  },
];

// ============================================
// SOUNDS
// ============================================

// ============================================
// ENDING OVERLAY COMPONENT
// ============================================
function EndingOverlay({ending, progress, gridRect}){
  if(!ending||!gridRect)return null;
  const ov=ending.overlay(progress);
  // Phase 1 (progress<0.35): Show big name + emoji intro
  // Phase 2 (progress>=0.35): Show overlay effects + action text
  const introPhase=progress<0.35;
  const introOpacity=introPhase?Math.min(1,progress/0.08):Math.max(0,1-(progress-0.35)/0.15);
  return(
    <div style={{position:"absolute",inset:0,pointerEvents:"none",zIndex:50,overflow:"hidden",borderRadius:"4px"}}>
      <div style={{position:"absolute",inset:0,background:introPhase?"#0a0a1acc":ov.bg,transition:"background 0.5s"}}/>
      {!introPhase&&ov.particles&&ov.particles.map((p,i)=>(
        <div key={i} style={{position:"absolute",left:`${p.x}%`,top:`${p.y}%`,width:`${p.size}px`,height:`${Math.min(p.size,8)}px`,background:p.color,borderRadius:"50%",opacity:p.opacity,animation:"snowfall 1s ease-out infinite",animationDelay:`${Math.random()}s`}}/>
      ))}
      {/* Big intro: emoji + name + description */}
      {introOpacity>0&&(
        <div style={{position:"absolute",top:"50%",left:"50%",transform:"translate(-50%,-50%)",textAlign:"center",zIndex:60,opacity:introOpacity,transition:"opacity 0.3s",width:"90%"}}>
          {ending.emoji&&<div style={{fontSize:"72px",animation:"pop 0.6s ease",marginBottom:"10px",filter:`drop-shadow(0 0 20px ${ending.color}88)`}}>{ending.emoji}</div>}
          <div style={{fontFamily:"inherit",fontSize:"24px",fontWeight:"700",color:ending.color,textShadow:`0 0 30px ${ending.color}aa, 0 0 60px ${ending.color}44`,animation:"pop 0.6s ease",letterSpacing:"2px",marginBottom:"14px"}}>
            {ending.name}
          </div>
          <div style={{fontFamily:"inherit",fontSize:"16px",fontWeight:"600",color:"#ffffff",textShadow:`0 0 20px ${ending.color}aa, 2px 2px 0 #000`,animation:"fadeIn 0.8s ease",lineHeight:"1.8",padding:"0 8px"}}>
            {ending.desc}
          </div>
        </div>
      )}
      {/* Action text during cell eating phase */}
      {!introPhase&&(
        <div style={{position:"absolute",top:"50%",left:"50%",transform:"translate(-50%,-50%)",textAlign:"center",zIndex:60,width:"90%"}}>
          {ending.emoji&&<div style={{fontSize:"56px",animation:"pop 0.4s ease",marginBottom:"6px"}}>{ending.emoji}</div>}
          <div style={{fontFamily:"inherit",fontSize:"18px",fontWeight:"600",color:"#ffffff",textShadow:`0 0 20px ${ending.color}aa, 2px 2px 0 #000`,lineHeight:"1.8",marginBottom:"8px"}}>
            {ending.desc}
          </div>
          {ov.text&&<div style={{fontFamily:"inherit",fontSize:"26px",fontWeight:"700",color:ov.textColor,textShadow:`0 0 20px ${ov.textColor}88, 0 0 40px ${ov.textColor}44`,animation:"pop 0.4s ease"}}>
            {ov.text}
          </div>}
        </div>
      )}
    </div>
  );
}

// ============================================
// ADSENSE BANNER
// ============================================
function AdBanner(){
  const adRef=useRef(null);
  const pushed=useRef(false);
  const[adLoaded,setAdLoaded]=useState(false);
  useEffect(()=>{
    if(pushed.current)return;
    const tryPush=()=>{
      if(window.adsbygoogle&&adRef.current){
        try{(window.adsbygoogle=window.adsbygoogle||[]).push({});}catch(e){}
        pushed.current=true;
        // Check if ad rendered (ins gets a child)
        const check=()=>{
          if(adRef.current&&adRef.current.querySelector("iframe,ins>div")){setAdLoaded(true);}
          else{setTimeout(check,1000);}
        };
        setTimeout(check,1500);
      }else{
        setTimeout(tryPush,500);
      }
    };
    tryPush();
  },[]);
  return(
    <div style={{width:"100%",maxWidth:"728px",margin:adLoaded?"4px auto 0":"0 auto",padding:0,zIndex:1,position:"relative",overflow:"hidden",
      maxHeight:adLoaded?"300px":"0",transition:"max-height 0.3s ease,margin 0.3s ease"}}>
      <ins ref={adRef} className="adsbygoogle"
        style={{display:"block"}}
        data-ad-client="ca-pub-8582386927565062"
        data-ad-slot="8910330266"
        data-ad-format="auto"
        data-full-width-responsive="true"/>
    </div>
  );
}

// ============================================
// CONFETTI CELEBRATION (multiplayer end)
// ============================================
function ConfettiCelebration({isWinner}){
  const canvasRef=useRef(null);
  const particles=useRef([]);
  const animRef=useRef(null);
  useEffect(()=>{
    const canvas=canvasRef.current;if(!canvas)return;
    const ctx=canvas.getContext("2d");
    const W=canvas.width=400,H=canvas.height=600;
    const colors=isWinner
      ?["#ffcc00","#00ff88","#ff66ff","#44ddff","#ff8844","#ffffff"]
      :["#00ff88","#44ddff","#8866ff","#ff66aa","#66ffaa"];
    const shapes=["rect","circle","star"];
    particles.current=Array.from({length:isWinner?120:60},()=>({
      x:Math.random()*W,y:Math.random()*-H,
      vx:(Math.random()-0.5)*3,vy:1.5+Math.random()*3,
      rot:Math.random()*360,vr:(Math.random()-0.5)*8,
      w:4+Math.random()*6,h:3+Math.random()*5,
      color:colors[Math.floor(Math.random()*colors.length)],
      shape:shapes[Math.floor(Math.random()*shapes.length)],
      opacity:0.7+Math.random()*0.3,
      wobble:Math.random()*Math.PI*2,wobbleSpeed:0.02+Math.random()*0.04
    }));
    function drawStar(cx,cy,r,ctx){
      ctx.beginPath();
      for(let i=0;i<5;i++){
        const a=Math.PI*2*i/5-Math.PI/2;
        const ax=cx+Math.cos(a)*r,ay=cy+Math.sin(a)*r;
        const b=Math.PI*2*(i+0.5)/5-Math.PI/2;
        const bx=cx+Math.cos(b)*r*0.4,by=cy+Math.sin(b)*r*0.4;
        if(i===0)ctx.moveTo(ax,ay);else ctx.lineTo(ax,ay);
        ctx.lineTo(bx,by);
      }
      ctx.closePath();ctx.fill();
    }
    function frame(){
      ctx.clearRect(0,0,W,H);
      for(const p of particles.current){
        p.y+=p.vy;p.x+=p.vx+Math.sin(p.wobble)*0.5;
        p.rot+=p.vr;p.wobble+=p.wobbleSpeed;
        if(p.y>H+20){p.y=-10;p.x=Math.random()*W;}
        ctx.save();ctx.translate(p.x,p.y);ctx.rotate(p.rot*Math.PI/180);
        ctx.globalAlpha=p.opacity;ctx.fillStyle=p.color;
        if(p.shape==="rect"){ctx.fillRect(-p.w/2,-p.h/2,p.w,p.h);}
        else if(p.shape==="circle"){ctx.beginPath();ctx.arc(0,0,p.w/2,0,Math.PI*2);ctx.fill();}
        else{drawStar(0,0,p.w/2,ctx);}
        ctx.restore();
      }
      animRef.current=requestAnimationFrame(frame);
    }
    frame();
    return()=>{if(animRef.current)cancelAnimationFrame(animRef.current);};
  },[isWinner]);
  return <canvas ref={canvasRef} style={{position:"fixed",top:0,left:"50%",transform:"translateX(-50%)",width:"100vw",maxWidth:"600px",height:"100vh",pointerEvents:"none",zIndex:10}}/>;
}

// ============================================
// SCORE POPUP
// ============================================
function ScorePopup({text,color,x,y}){
  return(<div style={{position:"fixed",left:x,top:y,transform:"translate(-50%,-50%)",pointerEvents:"none",zIndex:200,fontFamily:"inherit",fontSize:"20px",fontWeight:"700",color,textShadow:`0 0 10px ${color}88`,animation:"floatUp 1s ease-out forwards"}}>{text}</div>);
}
function WordPopup({text,color,x,y,font}){
  const len=text.length;
  const isEpic=len>=10;
  const isBig=len>=8;
  const sz=isEpic?"32px":isBig?"26px":"22px";
  const glow=isEpic?`0 0 24px ${color}88, 0 0 48px ${color}44, 0 2px 6px #00000066`:isBig?`0 0 16px ${color}66, 0 2px 4px #00000044`:`0 0 12px ${color}66, 0 2px 4px #00000044`;
  return(<div style={{position:"fixed",left:x,top:y,transform:"translate(-50%,-50%)",pointerEvents:"none",zIndex:199,fontFamily:font||"inherit",fontSize:sz,fontWeight:"700",letterSpacing:isEpic?"4px":"3px",color,textShadow:glow,animation:isEpic?"wordRiseEpic 1.8s ease-out forwards":isBig?"wordRiseBig 1.5s ease-out forwards":"wordRise 1.2s ease-out forwards"}}>
    {isEpic&&<span style={{fontSize:"16px",display:"block",textAlign:"center",marginBottom:"2px",animation:"pulse 0.3s ease"}}>WOW!</span>}
    {text}
  </div>);
}

// ============================================
// QUICK TUTORIAL - animated demo showing how to drag words
// ============================================
const TUTORIAL_GRIDS={
  fi:{
    // 4 rows × 5 cols – letters placed so paths spell real words
    // sauna: (2,0)s → (1,0)a → (0,0)u → (0,1)n → (1,1)a
    // suo:   (3,2)s → (3,1)u → (2,1)o
    grid:[
      ["u","n","k","e","t"],
      ["a","a","l","i","v"],
      ["s","o","m","a","p"],
      ["r","u","s","h","i"],
    ],
    words:[
      {word:"sauna",path:[[2,0],[1,0],[0,0],[0,1],[1,1]],color:"#44ff88"},
      {word:"suo",path:[[3,2],[3,1],[2,1]],color:"#ffaa44"},
    ],
  },
  en:{
    // train: (2,0)t → (1,0)r → (0,0)a → (0,1)i → (1,1)n
    // net:   (3,2)n → (3,1)e → (2,1)t
    grid:[
      ["a","i","k","o","p"],
      ["r","n","l","f","d"],
      ["t","t","m","h","s"],
      ["g","e","n","a","w"],
    ],
    words:[
      {word:"train",path:[[2,0],[1,0],[0,0],[0,1],[1,1]],color:"#44ff88"},
      {word:"net",path:[[3,2],[3,1],[2,1]],color:"#ffaa44"},
    ],
  },
  sv:{
    // storm: (2,0)s → (1,0)t → (0,0)o → (0,1)r → (1,1)m
    // sol:   (3,2)s → (3,1)o → (2,1)l
    grid:[
      ["o","r","k","e","n"],
      ["t","m","a","i","d"],
      ["s","l","v","h","p"],
      ["g","o","s","a","f"],
    ],
    words:[
      {word:"storm",path:[[2,0],[1,0],[0,0],[0,1],[1,1]],color:"#44ff88"},
      {word:"sol",path:[[3,2],[3,1],[2,1]],color:"#ffaa44"},
    ],
  },
};

function QuickTutorial({lang,theme,onClose}){
  const S=theme;
  const config=TUTORIAL_GRIDS[lang]||TUTORIAL_GRIDS.fi;
  const grid=config.grid;
  const rows=grid.length,cols=grid[0].length;
  const [step,setStep]=useState(0); // which word we're animating
  const [progress,setProgress]=useState(0); // 0..1 progress along current word path
  const [completedWords,setCompletedWords]=useState([]);
  const [wordFlash,setWordFlash]=useState(null);
  const containerRef=useRef(null);

  // Timing: each word takes ~2.5s to trace, 1s pause between, 1s at end
  const TRACE_DURATION=2500;
  const PAUSE_BETWEEN=800;
  const END_PAUSE=1500;

  useEffect(()=>{
    let cancelled=false;
    async function animate(){
      for(let wi=0;wi<config.words.length;wi++){
        if(cancelled)return;
        setStep(wi);
        setProgress(0);
        // Animate tracing
        await new Promise(resolve=>{
          const start=performance.now();
          function tick(now){
            if(cancelled){resolve();return;}
            const elapsed=now-start;
            const p=Math.min(1,elapsed/TRACE_DURATION);
            setProgress(p);
            if(p<1)requestAnimationFrame(tick);
            else{
              setCompletedWords(prev=>[...prev,wi]);
              setWordFlash(wi);
              setTimeout(()=>setWordFlash(null),600);
              setTimeout(resolve,PAUSE_BETWEEN);
            }
          }
          requestAnimationFrame(tick);
        });
      }
      // Wait at end then close
      if(!cancelled)setTimeout(()=>{if(!cancelled)onClose();},END_PAUSE);
    }
    animate();
    return()=>{cancelled=true;};
  },[]);

  // Calculate which cells are currently "selected" (traced by the pointer)
  const currentWord=config.words[step];
  const path=currentWord?currentWord.path:[];
  const cellCount=path.length;
  const activeCellCount=Math.min(cellCount,Math.floor(progress*cellCount)+1);
  const activeCells=path.slice(0,Math.min(activeCellCount,cellCount));

  // All completed word cells
  const completedCells=new Set();
  completedWords.forEach(wi=>{
    config.words[wi].path.forEach(([r,c])=>completedCells.add(`${r},${c}`));
  });

  // Pointer is visible when we're actively tracing (not between words)
  const pointerVisible=progress>0||step===0;

  // Get cell center position using DOM refs
  const cellRefs=useRef({});
  const getCellCenter=(r,c)=>{
    const el=cellRefs.current[`${r},${c}`];
    const container=containerRef.current;
    if(!el||!container)return null;
    const cRect=container.getBoundingClientRect();
    const eRect=el.getBoundingClientRect();
    return{
      x:eRect.left+eRect.width/2-cRect.left,
      y:eRect.top+eRect.height/2-cRect.top,
    };
  };

  const hexClip="polygon(50% 0%, 100% 25%, 100% 75%, 50% 100%, 0% 75%, 0% 25%)";

  // Build the formed word text
  const formedWord=activeCells.map(([r,c])=>grid[r][c]).join("").toUpperCase();
  const completedWordTexts=completedWords.map(wi=>config.words[wi].word.toUpperCase());

  return(
    <div style={{position:"fixed",top:0,left:0,width:"100%",height:"100%",background:"#000000dd",zIndex:300,display:"flex",alignItems:"center",justifyContent:"center",padding:"12px",animation:"fadeIn 0.3s ease"}} onClick={onClose}>
      <div style={{background:S.bg,border:`3px solid ${S.green}`,borderRadius:S.panelRadius,padding:"16px",maxWidth:"340px",width:"100%",boxShadow:S.panelShadow,position:"relative",maxHeight:"90vh",overflow:"auto"}} onClick={e=>e.stopPropagation()}>
        <button onClick={onClose} style={{position:"absolute",top:"6px",right:"6px",fontFamily:S.font,fontSize:"14px",color:S.green,background:"transparent",border:`2px solid ${S.green}`,width:"28px",height:"28px",cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center",borderRadius:S.btnRadius,zIndex:10}}>✕</button>

        {/* Formed word display */}
        <div style={{textAlign:"center",marginBottom:"8px",minHeight:"28px"}}>
          {formedWord&&!completedWords.includes(step)&&(
            <span style={{fontSize:"18px",fontWeight:"700",fontFamily:S.font,color:currentWord.color,letterSpacing:"3px",textShadow:`0 0 10px ${currentWord.color}66`,animation:"none"}}>{formedWord}</span>
          )}
          {wordFlash!==null&&(
            <span style={{fontSize:"18px",fontWeight:"700",fontFamily:S.font,color:config.words[wordFlash].color,letterSpacing:"3px",textShadow:`0 0 15px ${config.words[wordFlash].color}88`,animation:"pop 0.5s ease"}}>{config.words[wordFlash].word.toUpperCase()} ✓</span>
          )}
        </div>

        {/* Mini hex grid */}
        <div style={{position:"relative",width:"100%",paddingBottom:"78%",overflow:"hidden",borderRadius:"12px",background:S.gridBg||S.dark,border:`2px solid ${S.border}`}}>
          <div ref={containerRef} style={{position:"absolute",inset:0,padding:"6px 8px"}}>
            {grid.map((row,r)=>(
              <div key={r} style={{display:"flex",justifyContent:"center",gap:"3px",
                marginTop:r>0?"calc(-4.475% + 1px)":"0",
                transform:r%2===1?"translateX(calc(18% / 4 + 0.5px))":"translateX(calc(-18% / 4 - 0.5px))",
                position:"relative",zIndex:rows-r}}>
                {row.map((letter,c)=>{
                  const cellKey=`${r},${c}`;
                  const isActive=activeCells.some(([ar,ac])=>ar===r&&ac===c)&&!completedWords.includes(step);
                  const isCompleted=completedCells.has(cellKey);
                  const wordIdx=isCompleted?completedWords.find(wi=>config.words[wi].path.some(([pr,pc])=>pr===r&&pc===c)):null;
                  const completedColor=wordIdx!==null&&wordIdx!==undefined?config.words[wordIdx].color:null;
                  const activeColor=currentWord?currentWord.color:"#44ff88";
                  const isLast=isActive&&activeCells.length>0&&activeCells[activeCells.length-1][0]===r&&activeCells[activeCells.length-1][1]===c;
                  const selIdx=isActive?activeCells.findIndex(([ar,ac])=>ar===r&&ac===c):-1;
                  const borderBg=isActive?`linear-gradient(${120+selIdx*60}deg, #00ffaa, #44bbff, #aa66ff, #ff66aa, #ffaa44, #00ffaa)`:(isCompleted?`${completedColor}88`:(S.cellBorder||S.border));
                  const cellBg=isActive?`linear-gradient(${160+selIdx*30}deg, ${S.cell}ee 0%, ${S.cell}cc 40%, ${S.dark||S.cell}dd 100%)`:(isCompleted?`${completedColor}44`:S.cellGradient?`linear-gradient(160deg, ${S.cell} 0%, ${S.dark} 100%)`:S.cell);

                  return(
                    <div key={c} ref={el=>{if(el)cellRefs.current[`${r},${c}`]=el;}} style={{width:"18%",aspectRatio:"0.866",position:"relative",
                      transition:"transform 0.2s cubic-bezier(0.34,1.56,0.64,1)",
                      transform:isActive?(isLast?"scale(1.12)":"scale(1.05)"):"none",
                      zIndex:isActive?10:0}}>
                      {/* Outer border — prismatic when active */}
                      <div style={{position:"absolute",inset:isActive?"-2px":"0",clipPath:hexClip,
                        background:borderBg,
                        backgroundSize:isActive?"300% 100%":"100% 100%",
                        animation:isActive?"hexPrismatic 6s linear infinite":"none",
                        transition:"all 0.2s ease",
                        boxShadow:isActive?`0 0 12px ${S.green}88, 0 0 20px #aa66ff44`:"none"}}/>
                      {/* Glow ring */}
                      {isActive&&<div style={{position:"absolute",inset:"-5px",clipPath:hexClip,
                        background:"radial-gradient(ellipse at 50% 50%, #44ffaa33 0%, #8866ff22 40%, transparent 70%)",
                        pointerEvents:"none"}}/>}
                      {/* Inner cell */}
                      <div style={{position:"absolute",inset:isActive?"3px":"1px",clipPath:hexClip,
                        background:cellBg,
                        display:"flex",alignItems:"center",justifyContent:"center",
                        fontSize:"clamp(14px,4.5vw,22px)",fontFamily:S.letterFont,fontWeight:"700",
                        textTransform:"uppercase",transition:"all 0.2s ease",
                        color:isActive?"#ffffff":(isCompleted?"#ffffff":(S.cellText||(S.cellGradient?"#e6eef8":"#22ccaa"))),
                        textShadow:isActive?`0 0 12px #44ffaa99, 0 0 24px #8866ff66, 0 1px 2px #000000aa`:(isCompleted?`0 1px 3px #00000088, 0 0 8px ${completedColor}88`:"none")}}>
                        <span style={{position:"relative",zIndex:2,
                          filter:isActive?"drop-shadow(0 0 4px #44ffaa88) drop-shadow(0 0 8px #8866ff44)":(isCompleted?"drop-shadow(0 1px 1px #00000066)":"none"),
                        }}>{letter}</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            ))}

            {/* Animated hand pointer */}
            {pointerVisible&&!completedWords.includes(step)&&(()=>{
              // Interpolate between cell centers using DOM positions
              const totalSegments=Math.max(1,path.length-1);
              const exactPos=progress*totalSegments;
              const segIdx=Math.max(0,Math.min(Math.floor(exactPos),totalSegments-1));
              const segProgress=exactPos-segIdx;
              const p1=getCellCenter(...path[segIdx]);
              const p2=getCellCenter(...path[Math.min(segIdx+1,path.length-1)]);
              if(!p1||!p2)return null;
              const px=p1.x+(p2.x-p1.x)*segProgress;
              const py=p1.y+(p2.y-p1.y)*segProgress;
              return(
                <div style={{position:"absolute",left:`${px}px`,top:`${py}px`,transform:"translate(-10px, -2px)",
                  pointerEvents:"none",zIndex:50,transition:"none",filter:"drop-shadow(0 3px 6px #00000077)"}}>
                  <svg width="40" height="48" viewBox="0 0 100 120" fill="none" xmlns="http://www.w3.org/2000/svg">
                    {/* White glove pointing hand — index finger up, others curled */}
                    {/* Index finger */}
                    <path d="M42 8 C42 3, 48 0, 52 0 C56 0, 62 3, 62 8 L62 42 L42 42 Z" fill="white" stroke="#222" strokeWidth="3" strokeLinejoin="round"/>
                    <ellipse cx="52" cy="8" rx="7" ry="4" fill="#e8e8e8" opacity="0.5"/>
                    {/* Palm */}
                    <rect x="28" y="42" width="48" height="36" rx="10" fill="white" stroke="#222" strokeWidth="3"/>
                    {/* Thumb */}
                    <path d="M28 52 C20 50, 14 56, 16 64 C18 70, 26 72, 30 68" fill="white" stroke="#222" strokeWidth="3" strokeLinejoin="round"/>
                    {/* Curled fingers (bottom of palm) */}
                    <path d="M36 78 C36 88, 40 92, 44 92 C48 92, 50 88, 50 82" fill="white" stroke="#222" strokeWidth="2.5" strokeLinecap="round"/>
                    <path d="M50 78 C50 90, 54 94, 58 94 C62 94, 64 90, 64 82" fill="white" stroke="#222" strokeWidth="2.5" strokeLinecap="round"/>
                    <path d="M64 78 C64 86, 66 90, 70 88 C74 86, 74 80, 72 76" fill="white" stroke="#222" strokeWidth="2.5" strokeLinecap="round"/>
                    {/* Knuckle lines on index finger */}
                    <line x1="44" y1="22" x2="60" y2="22" stroke="#ccc" strokeWidth="1.5" strokeLinecap="round"/>
                    <line x1="44" y1="32" x2="60" y2="32" stroke="#ccc" strokeWidth="1.5" strokeLinecap="round"/>
                    {/* Cuff */}
                    <rect x="24" y="76" width="52" height="10" rx="3" fill="white" stroke="#222" strokeWidth="2.5"/>
                    {/* Touch ripple at fingertip */}
                    <circle cx="52" cy="4" r="8" fill="none" stroke="#44ffaa" strokeWidth="2" opacity="0.6">
                      <animate attributeName="r" values="6;16;6" dur="1.5s" repeatCount="indefinite"/>
                      <animate attributeName="opacity" values="0.7;0;0.7" dur="1.5s" repeatCount="indefinite"/>
                    </circle>
                  </svg>
                </div>
              );
            })()}
          </div>
        </div>

        {/* Completed words shown below */}
        <div style={{display:"flex",gap:"6px",justifyContent:"center",marginTop:"10px",minHeight:"24px",flexWrap:"wrap"}}>
          {completedWordTexts.map((w,i)=>(
            <span key={i} style={{fontSize:"13px",fontWeight:"700",fontFamily:S.font,color:config.words[i].color,
              padding:"2px 8px",border:`2px solid ${config.words[i].color}66`,borderRadius:"4px",
              background:`${config.words[i].color}15`,letterSpacing:"1px"}}>{w} ✓</span>
          ))}
        </div>
      </div>
    </div>
  );
}

// ============================================
// TITLE DEMO COMPONENT - shows word-finding animation in menu
// ============================================
// Per-language titles and demo words (subsequences to highlight)
// Activity-ring inspired title colors: red, lime-green, cyan, purple
const TITLE_COLORS=["#FF2D55","#FF375F","#E8254A","#A8FF00","#8CE600","#00E5FF","#00C8E0","#BF5AF2","#A040D0"];
function titleColor(i,len){
  // Spread the 4 ring colors across the title letters
  const colors=["#FF2D55","#FF6040","#A8FF00","#70E000","#00E5FF","#00C8E0","#BF5AF2","#A040D0","#FF2D55"];
  return colors[i%colors.length];
}
function titleShadow(color){return `2px 2px 0 ${color}44, 0 0 16px ${color}66`;}
const TITLE_CONFIG={
  fi:{
    title:"SANAPIILO",
    gearIdx:4, // the P in SANA⚙IILO
    // S(0) A(1) N(2) A(3) P(4) I(5) I(6) L(7) O(8)
    demos:[
      {word:"SANA",indices:[0,1,2,3],color:"#44ff88"},
      {word:"PII",indices:[4,5,6],color:"#4488ff"},
      {word:"ILO",indices:[6,7,8],color:"#ff8844"},
      {word:"PIILO",indices:[4,5,6,7,8],color:"#ff44cc"},
      {word:"SANAPIILO",indices:[0,1,2,3,4,5,6,7,8],color:"#ff6644"},
    ]
  },
  en:{
    title:"LETTERLOOT",
    gearIdx:7, // the first O in LETTERL⚙OT
    // L(0) E(1) T(2) T(3) E(4) R(5) L(6) O(7) O(8) T(9)
    demos:[
      {word:"LET",indices:[0,1,2],color:"#44ff88"},
      {word:"LOOT",indices:[6,7,8,9],color:"#4488ff"},
      {word:"LETTER",indices:[0,1,2,3,4,5],color:"#ff8844"},
      {word:"RLOOT",indices:[5,6,7,8,9],color:"#ff44cc"},
      {word:"LETTERLOOT",indices:[0,1,2,3,4,5,6,7,8,9],color:"#ff6644"},
    ]
  },
  sv:{
    title:"ORDLETARE",
    gearIdx:5, // the A in ORDLE⚙ARE
    // O(0) R(1) D(2) L(3) E(4) T(5) A(6) R(7) E(8)
    demos:[
      {word:"ORD",indices:[0,1,2],color:"#44ff88"},
      {word:"LET",indices:[3,4,5],color:"#4488ff"},
      {word:"LETA",indices:[3,4,5,6],color:"#ff8844"},
      {word:"ARE",indices:[6,7,8],color:"#ff44cc"},
      {word:"ORDLETARE",indices:[0,1,2,3,4,5,6,7,8],color:"#ff6644"},
    ]
  },
};

// Pixel art flags (9x6 grids)
const FLAG_PIXELS={
  fi:[
    "WWWBWWWWW",
    "WWWBWWWWW",
    "BBBBBBBBB",
    "BBBBBBBBB",
    "WWWBWWWWW",
    "WWWBWWWWW",
  ],
  en:[
    "BBBBRRRRRR",
    "BBBBWWWWWW",
    "BBBBRRRRRR",
    "WWWWWWWWWW",
    "RRRRRRRRRR",
    "WWWWWWWWWW",
  ],
  sv:[
    "BBBYBBBBB",
    "BBBYBBBBB",
    "YYYYYYYYY",
    "YYYYYYYYY",
    "BBBYBBBBB",
    "BBBYBBBBB",
  ],
};
const FLAG_COLS={fi:9,en:10,sv:9};
const FLAG_COLORS={W:"#ffffff",B:"#003580",R:"#cc2244",Y:"#ffcc00"};
function PixelFlag({lang,size=2}){
  const rows=FLAG_PIXELS[lang]||FLAG_PIXELS.fi;
  const cols=FLAG_COLS[lang]||9;
  const numRows=rows.length;
  return(
    <div style={{display:"inline-grid",gridTemplateColumns:`repeat(${cols},${size}px)`,gridTemplateRows:`repeat(${numRows},${size}px)`,gap:0,imageRendering:"pixelated",border:"1px solid #556",flexShrink:0}}>
      {rows.map((row,r)=>Array.from(row).map((ch,c)=>(
        <div key={r*cols+c} style={{width:size,height:size,background:FLAG_COLORS[ch]||"#000"}}/>
      )))}
    </div>
  );
}

// Pixel art icons (each row is a string, . = transparent, letter = color key)
const ICON_PIXELS={
  gear:{ // 19x19 multi-shaded pixel art gear (8 teeth, center hole)
    cols:19,
    rows:[
      "...................",
      ".........W.........",
      "........WWW........",
      "....WW..WhB..BB....",
      "...WWBW.WhB.BBBB...",
      "...WBhBWWhBBBlBB...",
      "....WBhhBBBllBB....",
      ".....WhBB.BBlB.....",
      "..WWWWBB...BBBBBB..",
      ".WWhhhB.....BdddBB.",
      "..WBBBBB...BBBBBB..",
      ".....BlBB.BBdB.....",
      "....BBllBBBddBB....",
      "...BBlBBBdBBBdBB...",
      "...BBBB.BdB.BBBB...",
      "....BB..BdB..BB....",
      "........BBB........",
      ".........B.........",
      "...................",
    ],
    colors:{B:"outline",W:"highlight",h:"light",l:"mid",d:"dark"},
  },
  swords:{ // 13x13 crossed swords with guards and handles
    cols:13,
    rows:[
      "S...........S",
      ".S.........S.",
      "..S.......S..",
      "...S.....S...",
      "....S...S....",
      ".....S.S.....",
      "......S......",
      ".....S.S.....",
      "....S...S....",
      "...GS...SG...",
      "..GGG...GGG..",
      "...H.....H...",
      "...H.....H...",
    ],
    colors:{S:"currentColor",G:"#ccaa44",H:"#aa7733"},
  },
  arrow:{ // 9x11 down arrow
    cols:9,
    rows:[
      "...A.A...",
      "...AAA...",
      "...AAA...",
      "...AAA...",
      "...AAA...",
      "...AAA...",
      ".A.AAA.A.",
      ".AAAAAAA.",
      "..AAAAA..",
      "...AAA...",
      "....A....",
    ],
    colors:{A:"currentColor"},
  },
  infinity:{ // 11x7 infinity
    cols:11,
    rows:[
      "..II...II..",
      ".I..I.I..I.",
      "I....I....I",
      "I....I....I",
      "I....I....I",
      ".I..I.I..I.",
      "..II...II..",
    ],
    colors:{I:"currentColor"},
  },
  refresh:{ // 11x11 circular arrows with arrowheads
    cols:11,
    rows:[
      "...RRRRR...",
      "..R.....R..",
      ".R.......R.",
      "R.....RRRRR",
      "R......RRR.",
      "R.......R..",
      "..R.......R",
      ".RRR......R",
      "RRRRR.....R",
      ".R.......R.",
      "..R.....R..",
      "...RRRRR...",
    ],
    colors:{R:"currentColor"},
  },
  share:{ // 9x9 share nodes with lines
    cols:9,
    rows:[
      "......SS.",
      "......SS.",
      "....SS...",
      "..SS.....",
      "..SS.....",
      "....SS...",
      "......SS.",
      "......SS.",
      ".........",
    ],
    colors:{S:"currentColor"},
  },
  musicOn:{ // 9x9 music note
    cols:9,
    rows:[
      "...MMMMMM",
      "...M....M",
      "...M....M",
      "...M....M",
      "...M..MMM",
      "..MM..M..",
      ".MMM..M..",
      "..M..MM..",
      "......M..",
    ],
    colors:{M:"currentColor"},
  },
  musicOff:{ // 9x9 music note with slash
    cols:9,
    rows:[
      "X..MMMMMM",
      ".X.m....m",
      "..Xm....m",
      "...X....m",
      "...mX.mmm",
      "..mm.Xm..",
      ".mmm..X..",
      "..m...mX.",
      "......m.X",
    ],
    colors:{M:"currentColor",m:"mid",X:"currentColor"},
  },
  stop:{ // 7x7 stop square
    cols:7,
    rows:[
      "SSSSSSS",
      "SSSSSSS",
      "SS...SS",
      "SS...SS",
      "SS...SS",
      "SSSSSSS",
      "SSSSSSS",
    ],
    colors:{S:"currentColor"},
  },
  person:{ // 9x9 compact person/user icon
    cols:9,
    rows:[
      "...PPP...",
      "..PPPPP..",
      "..PPPPP..",
      "...PPP...",
      ".PPPPPPP.",
      "PPPPPPPPP",
      "PP.PPP.PP",
      "...PPP...",
      "..PP.PP..",
    ],
    colors:{P:"currentColor"},
  },
};

// ============================================
// ACHIEVEMENT BADGE PIXEL ART (11x11 each)
// ============================================
const BADGE_PIXELS={
  star:{
    cols:9,rows:[
      "....*....",
      "...***...",
      "...***...",
      "*********",
      ".******.*",
      "..*****!.",
      "...*.*...",
      "..**.**!.",
      ".**...**.",
    ],colors:{"*":"currentColor","!":"currentColor"},
  },
  flame:{ // fire/streak
    cols:11,rows:[
      ".....*.....",
      "....**.....",
      "...**F*....",
      "..**FFF*...",
      "..*FFFFF*..",
      "..*FFFFF*..",
      ".*FFFFFFF*.",
      ".*FFFFFFF*.",
      ".*FFFFFFF*.",
      "..*FFFFF*..",
      "...***.*...",
    ],colors:{"*":"#ff4400",F:"currentColor"},
  },
  diamond:{
    cols:9,rows:[
      "....*....",
      "...*D*...",
      "..*DDD*..",
      ".*DDDDD*.",
      "*DDDDDDD*",
      ".*DDDDD*.",
      "..*DDD*..",
      "...*D*...",
      "....*....",
    ],colors:{"*":"outline",D:"currentColor"},
  },
  crown:{ // king crown
    cols:11,rows:[
      ".*...*...*.",
      ".*...*...*.",
      ".**.***..**",
      ".***.***..*",
      ".**GGGGG**.",
      ".*GGGGGGG*.",
      ".*GGGGGGG*.",
      ".*GGGGGGG*.",
      ".**GGGGG**.",
      "...........",
      "...........",
    ],colors:{"*":"currentColor",G:"#ffcc00"},
  },
  scroll:{ // word scroll
    cols:11,rows:[
      "..********.",
      ".*SSSSSS**.",
      ".*SSSSSS*.*",
      ".*SSSSSS*.*",
      ".*SSSSSS*.*",
      ".*SSSSSS*.*",
      ".*SSSSSS*.*",
      ".*SSSSSS*.*",
      ".**SSSSSS*.",
      "..********.",
      "...........",
    ],colors:{"*":"outline",S:"currentColor"},
  },
  trophy:{ // trophy cup
    cols:11,rows:[
      "...........",
      ".**GGGGG**.",
      "*.*GGGGG*.*",
      "*.*GGGGG*.*",
      "**.*GGG*..*",
      "...*GGG*...",
      "....*G*....",
      "....*G*....",
      "...*GGG*...",
      "..*GGGGG*..",
      "...........",
    ],colors:{"*":"outline",G:"currentColor"},
  },
  bolt:{ // lightning bolt speed
    cols:11,rows:[
      ".....****..",
      "....**.....",
      "...**......",
      "..**.......",
      ".********.*",
      "...........",
      ".*********.",
      ".......**.*",
      "......**...",
      ".....**....",
      "...**......",
    ],colors:{"*":"currentColor"},
  },
  sword:{ // arena sword
    cols:11,rows:[
      ".........*.",
      "........*..",
      ".......*...",
      "......*....",
      ".....*.....",
      "....*......",
      "..G*.......",
      ".GG........",
      "..G*.......",
      "...H.......",
      "...H.......",
    ],colors:{"*":"currentColor",G:"#ccaa44",H:"#aa7733"},
  },
};

// ============================================
// ACHIEVEMENT DEFINITIONS
// ============================================
const ACHIEVEMENTS={
  // Word-based achievements
  // -- TIER 1: Ensimmäinen peli (saa heti) --
  first_game:    {icon:"trophy", color:"#00ff88",tier:1,
    fi:"Ensimmäinen peli",     en:"First Game",         sv:"Första spelet",
    fi_d:"Pelaa ensimmäinen pelisi",en_d:"Play your first game",sv_d:"Spela ditt första spel",
    check:(s)=>s.gamesPlayed>=1},
  first_word:    {icon:"star",   color:"#00ff88",tier:1,
    fi:"Ensimmäinen sana",     en:"First Word",         sv:"Första ordet",
    fi_d:"Löydä ensimmäinen sanasi",en_d:"Find your first word",sv_d:"Hitta ditt första ord",
    check:(s)=>s.totalWords>=1},
  combo_3:       {icon:"flame",  color:"#ff6644",tier:1,
    fi:"Komboilija",           en:"Combo Starter",      sv:"Kombostartare",
    fi_d:"Saa 3 sanan kombo",en_d:"Get a 3 word combo",sv_d:"Få en 3-ordskombo",
    check:(s)=>s.bestCombo>=3},
  // -- TIER 2: Muutaman pelin jälkeen --
  hundred_words: {icon:"scroll", color:"#44ddff",tier:2,
    fi:"Sananiekka",           en:"Word Finder",        sv:"Ordhittare",
    fi_d:"Löydä 100 sanaa yhteensä",en_d:"Find 100 words total",sv_d:"Hitta 100 ord totalt",
    check:(s)=>s.totalWords>=100},
  ten_games:     {icon:"trophy", color:"#44ddff",tier:2,
    fi:"Kokenut pelaaja",      en:"Experienced",        sv:"Erfaren",
    fi_d:"Pelaa 10 peliä",en_d:"Play 10 games",sv_d:"Spela 10 spel",
    check:(s)=>s.gamesPlayed>=10},
  long_word_5:   {icon:"diamond",color:"#44ddff",tier:2,
    fi:"Pitkä sana",           en:"Long Word",          sv:"Långt ord",
    fi_d:"Löydä 5-kirjaiminen sana",en_d:"Find a 5-letter word",sv_d:"Hitta ett 5-bokstavsord",
    check:(s)=>s.longestWord>=5},
  score_30:      {icon:"star",   color:"#44ddff",tier:2,
    fi:"Hyvä alku",            en:"Good Start",         sv:"Bra start",
    fi_d:"Saa 30 pistettä yhdessä pelissä",en_d:"Score 30 in one game",sv_d:"Få 30 poäng i ett spel",
    check:(s)=>s.bestScore>=30},
  arena_player:  {icon:"sword",  color:"#ff6644",tier:2,
    fi:"Moninpelitaistelija",  en:"Multiplayer Fighter", sv:"Flerspelarkämpe",
    fi_d:"Pelaa moninpelissä",en_d:"Play in multiplayer",sv_d:"Spela flerspelare",
    check:(s)=>s.arenaGames>=1},
  polyglot:      {icon:"scroll", color:"#ffcc00",tier:2,
    fi:"Monikielinen",         en:"Polyglot",           sv:"Polyglott",
    fi_d:"Pelaa kaikilla kolmella kielellä",en_d:"Play in all three languages",sv_d:"Spela på alla tre språk",
    check:(s)=>(s.langsPlayed||[]).length>=3},
  // -- TIER 3: Kymmenien pelien jälkeen --
  five_hundred_words:{icon:"scroll",color:"#ff66ff",tier:3,
    fi:"Sanamestari",          en:"Word Master",        sv:"Ordmästare",
    fi_d:"Löydä 500 sanaa yhteensä",en_d:"Find 500 words total",sv_d:"Hitta 500 ord totalt",
    check:(s)=>s.totalWords>=500},
  fifty_games:   {icon:"trophy", color:"#ff66ff",tier:3,
    fi:"Veteraani",            en:"Veteran",            sv:"Veteran",
    fi_d:"Pelaa 50 peliä",en_d:"Play 50 games",sv_d:"Spela 50 spel",
    check:(s)=>s.gamesPlayed>=50},
  long_word_6:   {icon:"diamond",color:"#ff66ff",tier:3,
    fi:"Todella pitkä",        en:"Really Long",        sv:"Riktigt långt",
    fi_d:"Löydä 6-kirjaiminen sana",en_d:"Find a 6-letter word",sv_d:"Hitta ett 6-bokstavsord",
    check:(s)=>s.longestWord>=6},
  score_60:      {icon:"star",   color:"#ffcc00",tier:3,
    fi:"Kuusikymppinen",       en:"Sixty Club",         sv:"Sextio",
    fi_d:"Saa 60 pistettä yhdessä pelissä",en_d:"Score 60 in one game",sv_d:"Få 60 poäng i ett spel",
    check:(s)=>s.bestScore>=60},
  combo_5:       {icon:"flame",  color:"#ff66ff",tier:3,
    fi:"Megakombo",            en:"Mega Combo",         sv:"Megakombo",
    fi_d:"Saa 5 sanan kombo",en_d:"Get a 5 word combo",sv_d:"Få en 5-ordskombo",
    check:(s)=>s.bestCombo>=5},
  speed_8:       {icon:"bolt",   color:"#ffcc00",tier:3,
    fi:"Nopea sormi",          en:"Quick Finger",       sv:"Snabbt finger",
    fi_d:"Löydä 8 sanaa minuutissa",en_d:"Find 8 words per minute",sv_d:"Hitta 8 ord per minut",
    check:(s)=>s.bestWordsPerMin>=8},
  arena_winner:  {icon:"crown",  color:"#ff6644",tier:3,
    fi:"Moninpelivoittaja",    en:"Multiplayer Victor", sv:"Flerspelarvinnare",
    fi_d:"Voita moninpelikierros",en_d:"Win a multiplayer round",sv_d:"Vinn en flerspelarrunda",
    check:(s)=>s.arenaWins>=1},
  long_words_10: {icon:"diamond",color:"#44ddff",tier:3,
    fi:"Sanaetsijä",           en:"Word Hunter",        sv:"Ordjägare",
    fi_d:"Löydä 10 eri 6+ kirjaimen sanaa",en_d:"Find 10 different 6+ letter words",sv_d:"Hitta 10 olika 6+ bokstavsord",
    check:(s)=>s.longWordsTotal>=10},
  // -- TIER 4: Satoja pelejä, oikeasti hyvä --
  thousand_words:{icon:"scroll", color:"#ffcc00",tier:4,
    fi:"Sanalegenda",          en:"Word Legend",         sv:"Ordlegend",
    fi_d:"Löydä 1000 sanaa yhteensä",en_d:"Find 1000 words total",sv_d:"Hitta 1000 ord totalt",
    check:(s)=>s.totalWords>=1000},
  hundred_games: {icon:"trophy", color:"#ffcc00",tier:4,
    fi:"Omistautunut",         en:"Dedicated",          sv:"Hängiven",
    fi_d:"Pelaa 100 peliä",en_d:"Play 100 games",sv_d:"Spela 100 spel",
    check:(s)=>s.gamesPlayed>=100},
  long_word_7:   {icon:"diamond",color:"#ffcc00",tier:4,
    fi:"Sanamagiikka",         en:"Word Magic",         sv:"Ordmagi",
    fi_d:"Löydä 7+ kirjaimen sana",en_d:"Find a 7+ letter word",sv_d:"Hitta ett 7+ bokstavsord",
    check:(s)=>s.longestWord>=7},
  score_80:      {icon:"crown",  color:"#ffcc00",tier:4,
    fi:"Kahdeksankymppinen",   en:"Eighty Club",        sv:"Åttio",
    fi_d:"Saa 80 pistettä yhdessä pelissä",en_d:"Score 80 in one game",sv_d:"Få 80 poäng i ett spel",
    check:(s)=>s.bestScore>=80},
  combo_7:       {icon:"flame",  color:"#ffcc00",tier:4,
    fi:"Tulimyrsky",           en:"Firestorm",          sv:"Eldstorm",
    fi_d:"Saa 7 sanan kombo",en_d:"Get a 7 word combo",sv_d:"Få en 7-ordskombo",
    check:(s)=>s.bestCombo>=7},
  speed_12:      {icon:"bolt",   color:"#ff66ff",tier:4,
    fi:"Salamannopea",         en:"Speed Demon",        sv:"Blixtsnabb",
    fi_d:"Löydä 12 sanaa minuutissa",en_d:"Find 12 words per minute",sv_d:"Hitta 12 ord per minut",
    check:(s)=>s.bestWordsPerMin>=12},
  arena_5:       {icon:"sword",  color:"#ff66ff",tier:4,
    fi:"Gladiaattori",         en:"Gladiator",          sv:"Gladiator",
    fi_d:"Voita 5 moninpelikierrosta",en_d:"Win 5 multiplayer rounds",sv_d:"Vinn 5 flerspelarrundor",
    check:(s)=>s.arenaWins>=5},
  long_words_30: {icon:"diamond",color:"#ff66ff",tier:4,
    fi:"Sanakirja",            en:"Dictionary",         sv:"Ordbok",
    fi_d:"Löydä 30 eri 6+ kirjaimen sanaa",en_d:"Find 30 different 6+ letter words",sv_d:"Hitta 30 olika 6+ bokstavsord",
    check:(s)=>s.longWordsTotal>=30},
  marathon:      {icon:"trophy", color:"#ff6644",tier:4,
    fi:"Maratoonari",          en:"Marathoner",         sv:"Maratonlöpare",
    fi_d:"Pelaa 10 peliä yhden päivän aikana",en_d:"Play 10 games in one day",sv_d:"Spela 10 spel på en dag",
    check:(s)=>s.bestDayGames>=10},
  // -- TIER 5: Legenda, todella vaikea --
  three_thousand:{icon:"scroll", color:"#ff4400",tier:5,
    fi:"Sanatieteilijä",       en:"Lexicographer",      sv:"Lexikograf",
    fi_d:"Löydä 3000 sanaa yhteensä",en_d:"Find 3000 words total",sv_d:"Hitta 3000 ord totalt",
    check:(s)=>s.totalWords>=3000},
  score_100:     {icon:"crown",  color:"#ff4400",tier:5,
    fi:"Satanen",              en:"Century",            sv:"Hundra",
    fi_d:"Saa 100 pistettä yhdessä pelissä",en_d:"Score 100 in one game",sv_d:"Få 100 poäng i ett spel",
    check:(s)=>s.bestScore>=100},
  combo_10:      {icon:"flame",  color:"#ff4400",tier:5,
    fi:"Inferno",              en:"Inferno",            sv:"Inferno",
    fi_d:"Saa 10 sanan kombo",en_d:"Get a 10 word combo",sv_d:"Få en 10-ordskombo",
    check:(s)=>s.bestCombo>=10},
  arena_15:      {icon:"sword",  color:"#ff4400",tier:5,
    fi:"Mestari",              en:"Grand Master",       sv:"Stormästare",
    fi_d:"Voita 15 moninpelikierrosta",en_d:"Win 15 multiplayer rounds",sv_d:"Vinn 15 flerspelarrundor",
    check:(s)=>s.arenaWins>=15},
  perfect_game:  {icon:"crown",  color:"#ff4400",tier:5,
    fi:"Täydellinen peli",     en:"Perfect Game",       sv:"Perfekt spel",
    fi_d:"Löydä kaikki sanat yhdessä pelissä",en_d:"Find every word in a game",sv_d:"Hitta alla ord i ett spel",
    check:(s)=>s.perfectGames>=1},
  // -- TIER 6: Mahdoton / legenda --
  ten_thousand:  {icon:"scroll", color:"#ff0000",tier:6,
    fi:"Sanakoneen ydin",      en:"Word Engine",        sv:"Ordmaskin",
    fi_d:"Löydä 10 000 sanaa yhteensä",en_d:"Find 10,000 words total",sv_d:"Hitta 10 000 ord totalt",
    check:(s)=>s.totalWords>=10000},
  five_hundred_games:{icon:"trophy",color:"#ff0000",tier:6,
    fi:"Elinikäinen",          en:"Lifer",              sv:"Livstid",
    fi_d:"Pelaa 500 peliä",en_d:"Play 500 games",sv_d:"Spela 500 spel",
    check:(s)=>s.gamesPlayed>=500},
  score_150:     {icon:"crown",  color:"#ff0000",tier:6,
    fi:"Jumalallinen",         en:"Divine",             sv:"Gudomlig",
    fi_d:"Saa 150 pistettä yhdessä pelissä",en_d:"Score 150 in one game",sv_d:"Få 150 poäng i ett spel",
    check:(s)=>s.bestScore>=150},
  speed_15:      {icon:"bolt",   color:"#ff0000",tier:6,
    fi:"Aikamatkaaja",         en:"Time Traveler",      sv:"Tidsresenär",
    fi_d:"Löydä 15 sanaa minuutissa",en_d:"Find 15 words per minute",sv_d:"Hitta 15 ord per minut",
    check:(s)=>s.bestWordsPerMin>=15},
  arena_50:      {icon:"sword",  color:"#ff0000",tier:6,
    fi:"Kuolematon",           en:"Immortal",           sv:"Odödlig",
    fi_d:"Voita 50 moninpelikierrosta",en_d:"Win 50 multiplayer rounds",sv_d:"Vinn 50 flerspelarrundor",
    check:(s)=>s.arenaWins>=50},
  long_words_100:{icon:"diamond",color:"#ff0000",tier:6,
    fi:"Professori",           en:"Professor",          sv:"Professor",
    fi_d:"Löydä 100 eri 6+ kirjaimen sanaa",en_d:"Find 100 different 6+ letter words",sv_d:"Hitta 100 olika 6+ bokstavsord",
    check:(s)=>s.longWordsTotal>=100},
};

const INITIAL_STATS={totalWords:0,gamesPlayed:0,bestScore:0,bestCombo:0,longestWord:0,bestWordsPerMin:0,arenaGames:0,arenaWins:0,langsPlayed:[],perfectGames:0,longWordsTotal:0,bestDayGames:0,lastPlayDate:"",dayGames:0};

const SHADE_MAP={outline:0.4,dark:0.55,mid:0.7,light:0.85,highlight:1.0};
function ModernIcon({icon,color="currentColor",size=2,style={}}){
  const s=size*8;
  const icons={
    gear:<svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 010 2.83 2 2 0 01-2.83 0l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83 0 2 2 0 010-2.83l.06-.06A1.65 1.65 0 004.68 15a1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 012.83-2.83l.06.06A1.65 1.65 0 009 4.68a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 2.83l-.06.06A1.65 1.65 0 0019.4 9a1.65 1.65 0 001.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z"/></svg>,
    trophy:<svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M6 9H4.5a2.5 2.5 0 010-5H6"/><path d="M18 9h1.5a2.5 2.5 0 000-5H18"/><path d="M4 22h16"/><path d="M10 14.66V17c0 .55-.47.98-.97 1.21C7.85 18.75 7 20 7 22"/><path d="M14 14.66V17c0 .55.47.98.97 1.21C16.15 18.75 17 20 17 22"/><path d="M18 2H6v7a6 6 0 0012 0V2z"/></svg>,
    person:<svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>,
    arrow:<svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 5v14M5 12l7-7 7 7"/></svg>,
    infinity:<svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M18.178 8c5.096 0 5.096 8 0 8-5.095 0-7.133-8-12.739-8-4.585 0-4.585 8 0 8 5.606 0 7.644-8 12.74-8z"/></svg>,
    refresh:<svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/><path d="M3.51 9a9 9 0 0114.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0020.49 15"/></svg>,
    share:<svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/></svg>,
    musicOn:<svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg>,
    musicOff:<svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 18V5l12-2v13" opacity="0.3"/><circle cx="6" cy="18" r="3" opacity="0.3"/><circle cx="18" cy="16" r="3" opacity="0.3"/><line x1="2" y1="2" x2="22" y2="22" strokeWidth="2.5"/></svg>,
  };
  return <span style={{display:"inline-flex",alignItems:"center",verticalAlign:"middle",flexShrink:0,...style}}>{icons[icon]||null}</span>;
}
function PixelIcon({icon,color="currentColor",size=2,style={},badge=false}){
  const data=badge?BADGE_PIXELS[icon]:ICON_PIXELS[icon];
  if(!data)return null;
  const {cols,rows,colors}=data;
  const resolveColor=(ch)=>{
    if(ch===".")return"transparent";
    const v=colors[ch];
    if(v==="currentColor")return color;
    if(SHADE_MAP[v]!==undefined)return color;// shade handled via opacity
    return v;
  };
  const resolveOpacity=(ch)=>{
    if(ch===".")return 1;
    const v=colors[ch];
    return SHADE_MAP[v]!==undefined?SHADE_MAP[v]:1;
  };
  return(
    <div style={{display:"inline-grid",gridTemplateColumns:`repeat(${cols},${size}px)`,gridTemplateRows:`repeat(${rows.length},${size}px)`,
      gap:0,imageRendering:"pixelated",flexShrink:0,verticalAlign:"middle",transition:"filter 2s ease",...style}}>
      {rows.map((row,r)=>Array.from(row).map((ch,c)=>(
        <div key={r*cols+c} style={{width:size,height:size,
          background:resolveColor(ch),opacity:resolveOpacity(ch),transition:"background 2s ease"}}/>
      )))}
    </div>
  );
}

function TitleDemo({active,lang,onGearClick,showBubble,bubbleFading,hideGear,theme:titleTheme}){
  const tc=TITLE_CONFIG[lang]||TITLE_CONFIG.fi;
  const titleChars=tc.title.split("");
  const demoWords=tc.demos;
  const[wordIdx,setWordIdx]=useState(0);
  const[charStep,setCharStep]=useState(-1); // -1=pause, 0..n-1=highlighting, n=hold
  const[scramble,setScramble]=useState(false);
  const[displayChars,setDisplayChars]=useState(titleChars);
  const timerRef=useRef(null);
  const wordIdxRef=useRef(wordIdx);
  wordIdxRef.current=wordIdx;
  const charStepRef=useRef(charStep);
  charStepRef.current=charStep;
  const prevLangRef=useRef(lang);
  const[gearBlend,setGearBlend]=useState(false);
  useEffect(()=>{const t=setTimeout(()=>setGearBlend(true),10000);return()=>clearTimeout(t);},[]);

  // Scramble animation on language change
  useEffect(()=>{
    if(prevLangRef.current===lang){setDisplayChars(titleChars);return;}
    prevLangRef.current=lang;
    setScramble(true);setWordIdx(0);setCharStep(-1);
    clearTimeout(timerRef.current);
    const letters="ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖ";
    let step=0;const maxSteps=8;
    const prevTitle=(TITLE_CONFIG[prevLangRef.current]||TITLE_CONFIG.fi).title;
    const maxLen=Math.max(titleChars.length,prevTitle.length);
    function scrambleTick(){
      step++;
      const chars=[];
      for(let i=0;i<titleChars.length;i++){
        if(step>maxSteps-3&&i<step-(maxSteps-3)){chars.push(titleChars[i]);}
        else{chars.push(letters[Math.floor(Math.random()*letters.length)]);}
      }
      setDisplayChars(chars);
      if(step<maxSteps){setTimeout(scrambleTick,70);}
      else{setDisplayChars(titleChars);setScramble(false);}
    }
    scrambleTick();
  },[lang]);

  useEffect(()=>{
    if(!active||scramble){return;}
    function tick(){
      const wi=wordIdxRef.current;
      const cs=charStepRef.current;
      const dw=demoWords[wi%demoWords.length];
      if(cs===-1){
        setCharStep(0);
        timerRef.current=setTimeout(tick,220);
      }else if(cs<dw.indices.length-1){
        setCharStep(cs+1);
        timerRef.current=setTimeout(tick,220);
      }else if(cs===dw.indices.length-1){
        setCharStep(cs+1);
        timerRef.current=setTimeout(tick,1400);
      }else{
        setWordIdx((wi+1)%demoWords.length);
        setCharStep(-1);
        timerRef.current=setTimeout(tick,800);
      }
    }
    timerRef.current=setTimeout(tick,1500);
    return()=>clearTimeout(timerRef.current);
  },[active,scramble,lang]);

  const dw=demoWords[wordIdx%demoWords.length];
  const lit=new Set();
  if(active&&!scramble&&charStep>=0){
    for(let i=0;i<=Math.min(charStep,dw.indices.length-1);i++)lit.add(dw.indices[i]);
  }
  return(
    <div style={{position:"relative",display:"inline-block"}}>
    <div style={{display:"flex",justifyContent:"center",alignItems:"center",gap:"0",paddingTop:"8px",position:"relative"}}>
    <h1 style={{fontSize:"28px",letterSpacing:"4px",margin:"0 0 10px 0",display:"flex",justifyContent:"center",alignItems:"center",gap:"2px"}}>
      {displayChars.map((ch,i)=>{
        const isLit=lit.has(i);
        const isGear=!scramble&&i===tc.gearIdx;
        const tColor=titleColor(i,displayChars.length);
        const baseStyle={
          color:scramble?tColor+"88":tColor,
          textShadow:scramble
            ?`2px 2px 0 ${tColor}44, 0 0 10px ${tColor}44`
            :isLit
            ?`2px 2px 0 ${tColor}44, 0 0 20px ${dw.color}cc, 0 0 40px ${dw.color}66`
            :titleShadow(tColor),
          transition:scramble?"none":"text-shadow 0.25s ease, transform 0.25s ease",
          transform:scramble?`translateY(${Math.random()>0.5?-2:2}px)`:isLit?"translateY(-2px)":"none",
          fontFamily:titleTheme?.titleFont||"'Press Start 2P',monospace",
          lineHeight:1,
        };
        if(isGear&&!hideGear){
          return <span key={i} onClick={onGearClick} style={{...baseStyle,
            textShadow:"none",
            cursor:"pointer",
            display:"inline-flex",alignItems:"center",justifyContent:"center",
            marginRight:"4px",
          }}><PixelIcon icon="gear" color={isLit?dw.color:gearBlend?(titleTheme?.yellow||"#ffcc00"):(titleTheme?.textSoft||"#556677")} size={1.7} style={{transition:"filter 2s ease"}}/></span>;
        }
        return <span key={i} style={baseStyle}>{ch}</span>;
      })}
    </h1>
      {/* Coffee cup illustration - steaming, spills on lang change */}
      <svg width="64" height="64" viewBox="0 0 100 100" style={{position:"absolute",right:"-70px",top:"-8px",flexShrink:0,transition:"transform 0.15s ease",transform:scramble?"rotate(-12deg)":"rotate(0deg)"}}>
        {/* Steam — hidden during spill */}
        {!scramble&&<>
        <path d="M35 30 Q30 20 35 10" fill="none" stroke="#aaaaaa" strokeWidth="2.5" strokeLinecap="round" opacity="0.5">
          <animate attributeName="d" values="M35 30 Q30 20 35 10;M35 30 Q40 18 35 8;M35 30 Q30 20 35 10" dur="2.5s" repeatCount="indefinite"/>
          <animate attributeName="opacity" values="0.5;0.2;0.5" dur="2.5s" repeatCount="indefinite"/>
        </path>
        <path d="M50 28 Q45 16 50 6" fill="none" stroke="#aaaaaa" strokeWidth="2.5" strokeLinecap="round" opacity="0.6">
          <animate attributeName="d" values="M50 28 Q45 16 50 6;M50 28 Q55 14 50 4;M50 28 Q45 16 50 6" dur="2s" repeatCount="indefinite"/>
          <animate attributeName="opacity" values="0.6;0.25;0.6" dur="2s" repeatCount="indefinite"/>
        </path>
        <path d="M65 30 Q60 18 65 8" fill="none" stroke="#aaaaaa" strokeWidth="2.5" strokeLinecap="round" opacity="0.4">
          <animate attributeName="d" values="M65 30 Q60 18 65 8;M65 30 Q70 16 65 6;M65 30 Q60 18 65 8" dur="3s" repeatCount="indefinite"/>
          <animate attributeName="opacity" values="0.4;0.15;0.4" dur="3s" repeatCount="indefinite"/>
        </path>
        </>}
        {/* Coffee splash drops — only during spill */}
        {scramble&&<>
          <ellipse cx="18" cy="30" rx="4" ry="3" fill="#6b3a1f" opacity="0.8">
            <animate attributeName="cy" values="30;18;28" dur="0.6s" repeatCount="indefinite"/>
            <animate attributeName="opacity" values="0.8;0.4;0.8" dur="0.6s" repeatCount="indefinite"/>
          </ellipse>
          <ellipse cx="10" cy="36" rx="3" ry="2" fill="#8b5a2f" opacity="0.6">
            <animate attributeName="cy" values="36;26;34" dur="0.5s" repeatCount="indefinite"/>
            <animate attributeName="opacity" values="0.6;0.2;0.6" dur="0.5s" repeatCount="indefinite"/>
          </ellipse>
          <ellipse cx="24" cy="22" rx="2.5" ry="2" fill="#6b3a1f" opacity="0.7">
            <animate attributeName="cy" values="22;12;20" dur="0.7s" repeatCount="indefinite"/>
            <animate attributeName="opacity" values="0.7;0.3;0.7" dur="0.7s" repeatCount="indefinite"/>
          </ellipse>
        </>}
        {/* Cup body */}
        <path d="M22 38 L22 75 Q22 85 35 85 L65 85 Q78 85 78 75 L78 38 Z" fill="#f5e6d0" stroke="#8b6914" strokeWidth="2.5"/>
        {/* Coffee surface — tilts during spill */}
        <ellipse cx={scramble?"45":"50"} cy={scramble?"40":"42"} rx="28" ry={scramble?"7":"6"} fill="#6b3a1f" style={{transition:"all 0.2s ease"}}/>
        <ellipse cx={scramble?"44":"50"} cy={scramble?"39":"41"} rx="24" ry={scramble?"5":"4"} fill="#8b5a2f" opacity="0.6" style={{transition:"all 0.2s ease"}}/>
        {/* Handle */}
        <path d="M78 48 Q94 48 94 60 Q94 72 78 72" fill="none" stroke="#8b6914" strokeWidth="3" strokeLinecap="round"/>
        {/* Cup rim */}
        <ellipse cx="50" cy="38" rx="29" ry="6" fill="none" stroke="#8b6914" strokeWidth="2.5"/>
        {/* Face — normal vs embarrassed */}
        {scramble?<>
          {/* Embarrassed spiral eyes */}
          <g transform="translate(40,62)">
            <circle r="3.5" fill="none" stroke="#8b6914" strokeWidth="1.5">
              <animate attributeName="r" values="2;3.5;2" dur="0.4s" repeatCount="indefinite"/>
            </circle>
            <circle r="1" fill="#8b6914"/>
          </g>
          <g transform="translate(60,62)">
            <circle r="3.5" fill="none" stroke="#8b6914" strokeWidth="1.5">
              <animate attributeName="r" values="3.5;2;3.5" dur="0.4s" repeatCount="indefinite"/>
            </circle>
            <circle r="1" fill="#8b6914"/>
          </g>
          {/* Wavy embarrassed mouth */}
          <path d="M43 71 Q47 69 50 71 Q53 73 57 71" fill="none" stroke="#8b6914" strokeWidth="2" strokeLinecap="round"/>
          {/* Extra blush — more visible when embarrassed */}
          <ellipse cx="34" cy="68" rx="5" ry="3" fill="#ff8888" opacity="0.7"/>
          <ellipse cx="66" cy="68" rx="5" ry="3" fill="#ff8888" opacity="0.7"/>
          {/* Sweat drop */}
          <path d="M72 54 Q74 50 73 46" fill="none" stroke="#66aadd" strokeWidth="1.5" strokeLinecap="round" opacity="0.8"/>
          <circle cx="73" cy="46" r="1.5" fill="#66aadd" opacity="0.8"/>
        </>:<>
          {/* Normal happy face */}
          <circle cx="40" cy="62" r="2.5" fill="#8b6914"/>
          <circle cx="60" cy="62" r="2.5" fill="#8b6914"/>
          <path d="M44 70 Q50 75 56 70" fill="none" stroke="#8b6914" strokeWidth="2" strokeLinecap="round"/>
          {/* Normal blush */}
          <ellipse cx="34" cy="68" rx="4" ry="2.5" fill="#ffaaaa" opacity="0.5"/>
          <ellipse cx="66" cy="68" rx="4" ry="2.5" fill="#ffaaaa" opacity="0.5"/>
        </>}
      </svg>
    </div>
    {/* Speech bubble below title pointing up */}
    {showBubble&&!scramble&&(
      <div style={{position:"absolute",bottom:"-52px",left:"50%",transform:"translateX(-50%)",
        animation:bubbleFading?"bubbleOut 0.6s ease-in forwards":`bubbleIn 0.7s cubic-bezier(0.34,1.56,0.64,1) forwards`,
        whiteSpace:"nowrap",zIndex:50}}>
        <div style={{background:"#ffffff",color:"#000000",fontFamily:"'Press Start 2P',monospace",
          fontSize:"13px",padding:"8px 14px",borderRadius:"0px",position:"relative",lineHeight:"1.6",
          border:"3px solid #000000",boxShadow:"4px 4px 0 #00000044",
          imageRendering:"pixelated"}}>
          <div style={{position:"absolute",top:"-9px",left:"50%",transform:"translateX(-50%)",
            width:0,height:0,borderLeft:"8px solid transparent",borderRight:"8px solid transparent",borderBottom:"8px solid #000000"}}/>
          <div style={{position:"absolute",top:"-5px",left:"50%",transform:"translateX(-50%)",
            width:0,height:0,borderLeft:"6px solid transparent",borderRight:"6px solid transparent",borderBottom:"6px solid #ffffff"}}/>
          {lang==="en"?"Change settings like color theme!":lang==="sv"?"Ändra inställningar, som färgtema!":"Vaihda asetuksia, kuten väriteemaa!"}
        </div>
      </div>
    )}
    </div>
  );
}

// ============================================
// HALL OF FAME COMPONENT
// ============================================
function DailyPopup({dateStr,lang,t,S,myResult,onShare,dailyShareMsg,onClose}){
  const[leaderboard,setLeaderboard]=useState(null);
  const dl=dateLabel(dateStr,lang);
  const myNick=(()=>{try{const a=JSON.parse(localStorage.getItem("piilosana_auth")||"null");if(a?.nickname)return a.nickname;}catch{}return localStorage.getItem('piilosana_nick')||localStorage.getItem('piilosana_nickname')||'';})();
  useEffect(()=>{
    fetch(`/api/daily-scores/${dateStr}?lang=${lang}`).then(r=>r.json()).then(data=>{setLeaderboard(data);}).catch(()=>setLeaderboard([]));
  },[dateStr,lang]);
  return(
    <div style={{position:"fixed",top:0,left:0,width:"100%",height:"100%",background:"#000000cc",zIndex:200,display:"flex",alignItems:"center",justifyContent:"center",padding:"16px",animation:"fadeIn 0.2s ease"}} onClick={onClose}>
      <div style={{background:S.dark,border:`2px solid ${S.yellow||"#ffcc00"}`,borderRadius:S.panelRadius,width:"100%",maxWidth:"400px",padding:"20px",boxShadow:`0 0 30px ${S.yellow||"#ffcc00"}22`,maxHeight:"80vh",overflowY:"auto"}} onClick={e=>e.stopPropagation()}>
        <div style={{textAlign:"center",marginBottom:"12px"}}>
          <div style={{fontFamily:S.font,fontSize:"14px",color:S.yellow||"#ffcc00",fontWeight:"700",marginBottom:"4px",textTransform:"capitalize"}}>{t.daily} – {dl.full}</div>
        </div>
        {myResult&&(
          <div style={{textAlign:"center",marginBottom:"16px",padding:"12px",background:`${S.yellow||"#ffcc00"}11`,borderRadius:"10px",border:`1px solid ${S.yellow||"#ffcc00"}33`}}>
            <div style={{fontSize:"28px",fontWeight:"800",color:S.yellow}}>{myResult.score}<span style={{fontSize:"14px",fontWeight:"400",color:S.textMuted}}>p</span></div>
            {(()=>{const _pct=computePercentile(myResult.score,leaderboard);const _tier=tierForPercentile(_pct);if(!_tier)return null;const _txt=(PERCENTILE_TEXTS[lang]||PERCENTILE_TEXTS.fi);return(<div style={{fontSize:"13px",color:_tier.color,fontWeight:"700",letterSpacing:"0.5px",marginTop:"4px",animation:_tier.sparkle?"pulse 2s ease-in-out infinite":"none"}}>{_tier.sparkle?"✨ ":""}{_txt[_tier.textKey]}{_tier.sparkle?" ✨":""}</div>);})()}
            <div style={{fontSize:"13px",color:S.green,marginTop:"2px"}}>{myResult.wordsFound}/{myResult.totalWords} {t.dailyWords} ({myResult.totalWords>0?Math.round(myResult.wordsFound/myResult.totalWords*100):0}%)</div>
          </div>
        )}
        {/* Leaderboard */}
        <div style={{marginBottom:"12px"}}>
          <div style={{fontFamily:S.font,fontSize:"13px",fontWeight:"700",color:S.yellow||"#ffcc00",marginBottom:"8px",textAlign:"center"}}>{lang==="en"?"Leaderboard":lang==="sv"?"Topplista":"Tuloslista"}</div>
          {leaderboard===null?(
            <div style={{textAlign:"center",color:S.textMuted,fontSize:"13px",padding:"12px"}}>...</div>
          ):leaderboard.length===0?(
            <div style={{textAlign:"center",color:S.textMuted,fontSize:"13px",padding:"12px"}}>{lang==="en"?"No scores yet":lang==="sv"?"Inga poäng än":"Ei tuloksia vielä"}</div>
          ):(
            <div style={{display:"flex",flexDirection:"column",gap:"2px"}}>
              {leaderboard.map((s,i)=>{
                const isMe=myNick&&s.nickname.toLowerCase()===myNick.toLowerCase();
                const medals=["🥇","🥈","🥉"];
                return(
                  <div key={i} style={{display:"flex",alignItems:"center",padding:"6px 10px",borderRadius:"8px",
                    background:isMe?`${S.yellow||"#ffcc00"}22`:"transparent",
                    border:isMe?`1px solid ${S.yellow||"#ffcc00"}44`:"1px solid transparent"}}>
                    <span style={{width:"28px",fontSize:"14px",fontWeight:"700",color:i<3?(S.yellow||"#ffcc00"):S.textMuted}}>{i<3?medals[i]:`${i+1}.`}</span>
                    <span style={{flex:1,fontSize:"14px",fontWeight:isMe?"700":"500",color:isMe?(S.yellow||"#ffcc00"):(S.textSoft||"#444")}}>{s.nickname}</span>
                    <span style={{fontSize:"16px",fontWeight:"700",color:S.green||"#44ddaa"}}>{s.score}<span style={{fontSize:"11px",fontWeight:"400",color:S.textMuted}}>p</span></span>
                    <span style={{fontSize:"11px",color:S.textMuted,marginLeft:"8px",minWidth:"40px",textAlign:"right"}}>{s.words_found}/{s.words_total}</span>
                  </div>
                );
              })}
            </div>
          )}
        </div>
        <div style={{display:"flex",gap:"8px",justifyContent:"center"}}>
          {onShare&&<button onClick={e=>{e.stopPropagation();onShare();}} style={{fontFamily:S.font,fontSize:"13px",color:"#2a2000",background:`linear-gradient(135deg,${S.yellow||"#ffcc00"},#E6B800)`,border:"none",padding:"8px 20px",cursor:"pointer",borderRadius:"10px",fontWeight:"600"}}>
            {dailyShareMsg||t.dailyShare}
          </button>}
          <button onClick={onClose} style={{fontFamily:S.font,fontSize:"13px",color:S.textMuted,background:"transparent",border:`1px solid ${S.border}`,padding:"8px 20px",cursor:"pointer",borderRadius:"10px"}}>{t.back}</button>
        </div>
      </div>
    </div>
  );
}

function HallOfFame({gameMode,gameTime,currentScore,S,lang}){
  const[scores,setScores]=useState(null);
  const[loading,setLoading]=useState(true);
  useEffect(()=>{
    if(!gameMode||!gameTime||gameTime===0)return;
    setLoading(true);
    fetch(`${SERVER_URL}/api/hall-of-fame/${gameMode}/${gameTime}?lang=${lang||"fi"}`)
      .then(r=>r.json()).then(data=>{setScores(data);setLoading(false);})
      .catch(()=>{setScores([]);setLoading(false);});
  },[gameMode,gameTime,currentScore,lang]);
  if(!gameMode||!gameTime||gameTime===0)return null;
  const label=gameMode==="tetris"?(lang==="en"?"Drop":lang==="sv"?"Fall":"Pudotus"):lang==="en"?"Normal":lang==="sv"?"Normal":"Normaali";
  const timeMins=gameTime/60;const timeLabel=Number.isInteger(timeMins)?`${timeMins} min`:lang==="en"?`${timeMins.toFixed(1)} min`:`${timeMins.toFixed(1).replace(".",",")} min`;
  const hofTitle=lang==="en"?"RECORDS":lang==="sv"?"REKORD":"ENNÄTYKSET";
  const hofLoading=lang==="en"?"Loading...":lang==="sv"?"Laddar...":"Ladataan...";
  const hofEmpty=lang==="en"?"No results yet":lang==="sv"?"Inga resultat ännu":"Ei tuloksia vielä";
  return(
    <div style={{border:`1px solid ${S.border}`,padding:"14px",background:`${S.dark}ee`,marginTop:"12px",animation:"fadeIn 0.8s ease",borderRadius:"12px",backdropFilter:"blur(8px)",WebkitBackdropFilter:"blur(8px)"}}>
      <div style={{fontSize:"14px",color:S.yellow,marginBottom:"8px",fontWeight:"bold",letterSpacing:"0.5px",display:"flex",alignItems:"center",gap:"6px"}}><PixelFlag lang={lang||"fi"} size={2}/>{hofTitle} <span style={{fontWeight:"normal",fontSize:"12px",color:S.textMuted}}>({label} {timeLabel})</span></div>
      {loading?<div style={{fontSize:"13px",color:S.textMuted,textAlign:"center"}}>{hofLoading}</div>:
      !scores||scores.length===0?<div style={{fontSize:"13px",color:S.textMuted,textAlign:"center"}}>{hofEmpty}</div>:
      <div style={{display:"flex",flexDirection:"column",gap:"2px"}}>
        {scores.map((s,i)=>{
          const isHighlight=currentScore&&s.score===currentScore&&i<10;
          const medals=["🥇","🥈","🥉"];
          return <div key={i} style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"5px 8px",
            background:i===0?"#ffcc0015":isHighlight?"#44ff8815":i<3?`${S.border}08`:"transparent",
            border:i===0?`1px solid ${S.yellow}33`:isHighlight?`1px solid ${S.green}33`:"1px solid transparent",
            borderRadius:"8px",marginBottom:"1px"}}>
            <div style={{display:"flex",gap:"8px",alignItems:"center"}}>
              <span style={{fontSize:i<3?"16px":"13px",minWidth:"24px"}}>{i<3?medals[i]:<span style={{color:S.textMuted}}>{i+1}.</span>}</span>
              <span style={{fontSize:"13px",color:i===0?S.yellow:isHighlight?S.green:i<3?"#cccccc":S.textSoft,fontWeight:i<3||isHighlight?"600":"normal"}}>{s.nickname}</span>
            </div>
            <div style={{display:"flex",gap:"12px",alignItems:"center"}}>
              <span style={{fontSize:i===0?"14px":"13px",color:(tierForPercentile(computePercentile(s.score,scores))?.color)||S.yellow,fontWeight:i<3?"bold":"normal",transition:"color 0.3s ease"}}>{s.score}p</span>
              <span style={{fontSize:"13px",color:S.textSoft||"#88ccaa"}}>{s.percentage}%</span>
            </div>
          </div>;
        })}
      </div>}
    </div>
  );
}

// Submit score to hall of fame
async function submitToHallOfFame({nickname,score,wordsFound,wordsTotal,gameMode,gameTime,lang}){
  if(!nickname||score<=0||!gameMode||!gameTime||gameTime===0)return null;
  try{
    const res=await fetch(`${SERVER_URL}/api/hall-of-fame`,{
      method:"POST",headers:{"Content-Type":"application/json"},
      body:JSON.stringify({nickname,score,wordsFound,wordsTotal,gameMode,gameTime,lang:lang||"fi"})
    });
    if(!res.ok)return null;
    return await res.json();
  }catch{return null;}
}

// ============================================
// MAIN COMPONENT
// ============================================
export default function Piilosana(){
  const SZ=5,HEX_ROWS=7,HEX_COLS=5,COMBO_WINDOW=4000;
  const[lang,setLang]=useState(()=>localStorage.getItem("piilosana_lang")||"fi");
  const[themeId,setThemeId]=useState(()=>{const saved=localStorage.getItem("piilosana_theme");return saved&&THEMES[saved]?saved:"light";});
  const[uiSize,setUiSize]=useState(()=>localStorage.getItem("piilosana_size")||"normal");
  const[confettiOn,setConfettiOn]=useState(()=>localStorage.getItem("piilosana_confetti")!=="off");
  const audio = useAudioSystem();
  const { sounds, soundTheme, musicOn, musicTrack, audioStarted,
          setSoundTheme, setMusicOn, setMusicTrack, music, musicTracks } = audio;
  const[updateAvailable,setUpdateAvailable]=useState(false);
  const[wordsLoaded,setWordsLoaded]=useState(()=>({fi:LANG_CONFIG.fi.loaded,en:LANG_CONFIG.en.loaded,sv:LANG_CONFIG.sv.loaded}));
  useEffect(()=>{
    let mounted=true;
    Promise.all([loadWords("fi"),loadWords("en"),loadWords("sv")]).then(()=>{
      if(mounted)setWordsLoaded({fi:true,en:true,sv:true});
    });
    // Also update as each individual language loads
    loadWords("fi").then(()=>{if(mounted)setWordsLoaded(p=>({...p,fi:true}));});
    loadWords("en").then(()=>{if(mounted)setWordsLoaded(p=>({...p,en:true}));});
    loadWords("sv").then(()=>{if(mounted)setWordsLoaded(p=>({...p,sv:true}));});
    return()=>{mounted=false;};
  },[]);
  // Version polling — detect deploys, show update banner
  useEffect(()=>{
    let v0=null,mounted=true;
    const check=()=>fetch('/api/version').then(r=>r.json()).then(d=>{
      if(!mounted)return;
      if(!v0)v0=d.version;
      else if(d.version!==v0)setUpdateAvailable(true);
    }).catch(()=>{});
    check();
    const iv=setInterval(check,3*60*1000); // every 3 min
    return()=>{mounted=false;clearInterval(iv);};
  },[]);
  const currentLangLoaded=wordsLoaded[lang]||false;
  const[showSettings,setShowSettings]=useState(false);
  const[showMenuOptions,setShowMenuOptions]=useState(false);
  const[settingsBubble,setSettingsBubble]=useState(false);
  const[bubbleFading,setBubbleFading]=useState(false);
  const[flagBubble,setFlagBubble]=useState(false);
  const[flagBubbleFading,setFlagBubbleFading]=useState(false);
  const[showWordInfo,setShowWordInfo]=useState(false);
  const[showHelp,setShowHelp]=useState(false);
  const[showInflection,setShowInflection]=useState(false);
  const[showTutorial,setShowTutorial]=useState(false);
  const[dailyMode,setDailyMode]=useState(false);
  const[dailyTheme,setDailyTheme]=useState(null);
  const[dailyThemeFound,setDailyThemeFound]=useState([]); // stems of theme words found in daily
  const[dailyThemeBonusGiven,setDailyThemeBonusGiven]=useState(false);
  const[dailyResult,setDailyResult]=useState(()=>getDailyResult(lang));
  // Refresh daily result when language changes
  useEffect(()=>{setDailyResult(getDailyResult(lang));},[lang]);
  const[dailyShareMsg,setDailyShareMsg]=useState(null);
  const[showDailyHistory,setShowDailyHistory]=useState(null); // date string or null
  const[showExitConfirm,setShowExitConfirm]=useState(false);
  const[showHamburger,setShowHamburger]=useState(false);
  const[muteEmojis,setMuteEmojis]=useState(()=>localStorage.getItem("piilosana_mute_emoji")==="on");
  const muteEmojisRef=useRef(muteEmojis);
  useEffect(()=>{muteEmojisRef.current=muteEmojis;},[muteEmojis]);
  const[gearBlend,setGearBlend]=useState(false);
  useEffect(()=>{const t=setTimeout(()=>setGearBlend(true),10000);return()=>clearTimeout(t);},[]);
  const[themeTransition,setThemeTransition]=useState(false);
  const themeInitRef=useRef(true);
  useEffect(()=>{if(themeInitRef.current){themeInitRef.current=false;return;}setThemeTransition(true);const t=setTimeout(()=>setThemeTransition(false),700);return()=>clearTimeout(t);},[themeId]);

  // Auth state
  const[authUser,setAuthUser]=useState(()=>{
    try{const s=localStorage.getItem("piilosana_auth");return s?JSON.parse(s):null;}catch{return null;}
  });
  const[showAuth,setShowAuth]=useState(false);
  const[authMode,setAuthMode]=useState("login"); // "login", "register", or "forgot"
  const[authError,setAuthError]=useState("");
  const[authLoading,setAuthLoading]=useState(false);
  const[authSuccess,setAuthSuccess]=useState("");
  const[showFirstTimeAuth,setShowFirstTimeAuth]=useState(()=>!localStorage.getItem("piilosana_auth")&&!sessionStorage.getItem("piilosana_auth_dismissed"));

  const applySettings=useCallback((s)=>{
    if(!s)return;
    if(s.theme){setThemeId(s.theme);localStorage.setItem("piilosana_theme",s.theme);}
    if(s.lang){setLang(s.lang);localStorage.setItem("piilosana_lang",s.lang);}
    if(s.size){setUiSize(s.size);localStorage.setItem("piilosana_size",s.size);}
    if(typeof s.confetti==="boolean"){setConfettiOn(s.confetti);localStorage.setItem("piilosana_confetti",s.confetti?"on":"off");}
    if(s.sound){const snd=s.sound==="modern"||s.sound==="off"?s.sound:"modern";setSoundTheme(snd);localStorage.setItem("piilosana_sound",snd);}
    if(typeof s.music==="boolean"){setMusicOn(s.music);localStorage.setItem("piilosana_music",s.music?"on":"off");}
  },[]);
  const doLogin=useCallback(async(nickname,password)=>{
    setAuthLoading(true);setAuthError("");
    try{
      const res=await fetch(`${SERVER_URL}/api/login`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({nickname,password})});
      const data=await res.json();
      if(!res.ok){setAuthError(data.error||"Virhe");setAuthLoading(false);return false;}
      setAuthUser(data.user);localStorage.setItem("piilosana_auth",JSON.stringify(data.user));
      localStorage.setItem("piilosana_auth_cred",JSON.stringify({nickname,password}));
      if(data.user.settings)applySettings(data.user.settings);
      setShowAuth(false);setShowFirstTimeAuth(false);setAuthLoading(false);return true;
    }catch{setAuthError("Yhteysvirhe");setAuthLoading(false);return false;}
  },[applySettings]);

  const doRegister=useCallback(async(nickname,password,email,email2)=>{
    setAuthLoading(true);setAuthError("");
    try{
      const res=await fetch(`${SERVER_URL}/api/register`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({nickname,password,email,email2})});
      const data=await res.json();
      if(!res.ok){setAuthError(data.error||"Virhe");setAuthLoading(false);return false;}
      setAuthUser(data.user);localStorage.setItem("piilosana_auth",JSON.stringify(data.user));
      localStorage.setItem("piilosana_auth_cred",JSON.stringify({nickname,password}));
      setShowAuth(false);setShowFirstTimeAuth(false);setAuthLoading(false);return true;
    }catch{setAuthError("Yhteysvirhe");setAuthLoading(false);return false;}
  },[]);

  const[googleClientId,setGoogleClientId]=useState(null);
  // Fetch Google Client ID on mount
  useEffect(()=>{
    fetch(`${SERVER_URL}/api/google-client-id`).then(r=>r.json()).then(d=>{
      if(d.clientId){
        setGoogleClientId(d.clientId);
        // Load GSI script
        if(!document.getElementById("gsi-script")){
          const s=document.createElement("script");
          s.id="gsi-script";s.src="https://accounts.google.com/gsi/client";s.async=true;
          document.head.appendChild(s);
        }
      }
    }).catch(()=>{});
  },[]);

  const doGoogleLogin=useCallback(async(credential)=>{
    setAuthLoading(true);setAuthError("");
    try{
      const res=await fetch(`${SERVER_URL}/api/google-login`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({credential})});
      const data=await res.json();
      if(!res.ok){setAuthError(data.error||"Virhe");setAuthLoading(false);return false;}
      setAuthUser(data.user);localStorage.setItem("piilosana_auth",JSON.stringify(data.user));
      localStorage.setItem("piilosana_auth_cred",JSON.stringify({nickname:data.user.nickname,google:true}));
      if(data.user.settings)applySettings(data.user.settings);
      setShowAuth(false);setShowFirstTimeAuth(false);setAuthLoading(false);return true;
    }catch{setAuthError("Yhteysvirhe");setAuthLoading(false);return false;}
  },[applySettings]);

  const doLogout=useCallback(()=>{
    setAuthUser(null);localStorage.removeItem("piilosana_auth");localStorage.removeItem("piilosana_auth_cred");
  },[]);
  const saveSettingsToServer=useCallback(async(settings)=>{
    try{
      const cred=JSON.parse(localStorage.getItem("piilosana_auth_cred")||"null");
      if(!cred)return;
      await fetch(`${SERVER_URL}/api/settings`,{method:"POST",headers:{"Content-Type":"application/json"},
        body:JSON.stringify({nickname:cred.nickname,password:cred.password,settings})});
    }catch{}
  },[]);
  const syncSettings=useCallback((overrides={})=>{
    if(!authUser)return;
    const s={theme:themeId,lang,size:uiSize,confetti:confettiOn,sound:soundTheme,music:musicOn,...overrides};
    saveSettingsToServer(s);
  },[authUser,themeId,lang,uiSize,confettiOn,soundTheme,musicOn,saveSettingsToServer]);

  const doChangePassword=useCallback(async(currentPassword,newPassword)=>{
    setAuthLoading(true);setAuthError("");setAuthSuccess("");
    try{
      const res=await fetch(`${SERVER_URL}/api/change-password`,{method:"POST",headers:{"Content-Type":"application/json"},
        body:JSON.stringify({nickname:authUser?.nickname,currentPassword,newPassword})});
      const data=await res.json();
      if(!res.ok){setAuthError(data.error||"Virhe");setAuthLoading(false);return;}
      localStorage.setItem("piilosana_auth_cred",JSON.stringify({nickname:authUser.nickname,password:newPassword}));
      setAuthSuccess(lang==="en"?"Password changed!":lang==="sv"?"Lösenord ändrat!":"Salasana vaihdettu!");
      setAuthLoading(false);
    }catch{setAuthError("Yhteysvirhe");setAuthLoading(false);}
  },[authUser,lang]);

  const doForgotPassword=useCallback(async(email)=>{
    setAuthLoading(true);setAuthError("");setAuthSuccess("");
    try{
      const res=await fetch(`${SERVER_URL}/api/forgot-password`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({email})});
      const data=await res.json();
      if(!res.ok){setAuthError(data.error||"Virhe");setAuthLoading(false);return;}
      setAuthSuccess(data.message);setAuthLoading(false);
    }catch{setAuthError("Yhteysvirhe");setAuthLoading(false);}
  },[]);

  // ============================================
  // ACHIEVEMENTS STATE
  // ============================================
  const[achStats,setAchStats]=useState(()=>{
    try{const s=localStorage.getItem("piilosana_ach_stats");return s?{...INITIAL_STATS,...JSON.parse(s)}:{...INITIAL_STATS};}catch{return{...INITIAL_STATS};}
  });
  const[achUnlocked,setAchUnlocked]=useState(()=>{
    try{const s=localStorage.getItem("piilosana_ach_unlocked");return s?JSON.parse(s):{};}catch{return{};}
  });
  const[showAchievements,setShowAchievements]=useState(false);
  const[newAchPopup,setNewAchPopup]=useState(null);
  const achStatsRef=useRef(achStats);
  achStatsRef.current=achStats;
  const achUnlockedRef=useRef(achUnlocked);
  achUnlockedRef.current=achUnlocked;

  // Load achievements from server on login
  useEffect(()=>{
    if(authUser?.achievements){
      const serverAch=authUser.achievements;
      if(serverAch.stats){
        const merged={...INITIAL_STATS,...serverAch.stats};
        // Take max of local and server stats
        const local=achStatsRef.current;
        const best={...merged};
        for(const k of["totalWords","gamesPlayed","bestScore","bestCombo","longestWord","bestWordsPerMin","arenaGames","arenaWins"]){
          best[k]=Math.max(local[k]||0,merged[k]||0);
        }
        best.langsPlayed=[...new Set([...(local.langsPlayed||[]),...(merged.langsPlayed||[])])];
        setAchStats(best);localStorage.setItem("piilosana_ach_stats",JSON.stringify(best));
      }
      if(serverAch.unlocked){
        const merged={...achUnlockedRef.current,...serverAch.unlocked};
        setAchUnlocked(merged);localStorage.setItem("piilosana_ach_unlocked",JSON.stringify(merged));
      }
    }
  },[authUser]);

  const saveAchievementsToServer=useCallback(async(stats,unlocked)=>{
    try{
      const cred=JSON.parse(localStorage.getItem("piilosana_auth_cred")||"null");
      if(!cred)return;
      await fetch(`${SERVER_URL}/api/achievements`,{method:"POST",headers:{"Content-Type":"application/json"},
        body:JSON.stringify({nickname:cred.nickname,password:cred.password,achievements:{stats,unlocked}})});
    }catch{}
  },[]);

  const checkAchievements=useCallback((newStats)=>{
    const prev=achUnlockedRef.current;
    const newUnlocked={...prev};
    let anyNew=null;
    for(const[id,ach]of Object.entries(ACHIEVEMENTS)){
      if(!prev[id]&&ach.check(newStats)){
        newUnlocked[id]=Date.now();
        anyNew=id;
      }
    }
    if(anyNew){
      setAchUnlocked(newUnlocked);
      localStorage.setItem("piilosana_ach_unlocked",JSON.stringify(newUnlocked));
      achUnlockedRef.current=newUnlocked;
      // Show popup for the last unlocked one
      setNewAchPopup(anyNew);
      setTimeout(()=>setNewAchPopup(null),3500);
      saveAchievementsToServer(newStats,newUnlocked);
    }
    return newUnlocked;
  },[saveAchievementsToServer]);

  const updateAchStats=useCallback((updates)=>{
    setAchStats(prev=>{
      const next={...prev,...updates};
      // For array fields like langsPlayed, merge
      if(updates.langsPlayed){
        next.langsPlayed=[...new Set([...(prev.langsPlayed||[]),...updates.langsPlayed])];
      }
      // Keep max values for best* fields
      for(const k of["bestScore","bestCombo","longestWord","bestWordsPerMin"]){
        if(updates[k]!==undefined)next[k]=Math.max(prev[k]||0,updates[k]);
      }
      // Accumulate counters
      if(updates.addWords)next.totalWords=(prev.totalWords||0)+updates.addWords;
      if(updates.addGames)next.gamesPlayed=(prev.gamesPlayed||0)+updates.addGames;
      if(updates.addArenaGames)next.arenaGames=(prev.arenaGames||0)+updates.addArenaGames;
      if(updates.addArenaWins)next.arenaWins=(prev.arenaWins||0)+updates.addArenaWins;
      if(updates.addLongWords)next.longWordsTotal=(prev.longWordsTotal||0)+updates.addLongWords;
      if(updates.addPerfect)next.perfectGames=(prev.perfectGames||0)+1;
      // Daily games tracking
      if(updates.dayDate){
        if(prev.lastPlayDate===updates.dayDate){
          next.dayGames=(prev.dayGames||0)+1;
        }else{
          next.dayGames=1;
        }
        next.lastPlayDate=updates.dayDate;
        next.bestDayGames=Math.max(prev.bestDayGames||0,next.dayGames);
      }
      localStorage.setItem("piilosana_ach_stats",JSON.stringify(next));
      achStatsRef.current=next;
      checkAchievements(next);
      return next;
    });
  },[checkAchievements]);

  const theme=getTheme(themeId);
  const langConf=getLangConf(lang);
  // Re-derive when wordsLoaded changes (lazy loading completes)
  const WORDS_SET=currentLangLoaded?langConf.words:EMPTY_SET;
  const trie=useMemo(()=>currentLangLoaded?langConf.trie:EMPTY_TRIE,[lang,currentLangLoaded]);
  const t=T[lang]||T.fi;
  const isLarge=uiSize==="large";

  // Game settings (must be declared before states that reference them)
  const[gameTime,setGameTime]=useState(120); // 120 (2min) or 402 (6min 42s = "6,7")
  const[letterMult,setLetterMult]=useState(false); // scrabble-style letter values
  const[soloMode,setSoloMode]=useState("hex"); // 'hex' is the default and only visible mode
  const[dropKey,setDropKey]=useState(0); // increments on gravity to trigger drop animation
  const[gameMode,setGameMode]=useState("classic"); // 'classic' or 'battle'

  // Rotate mode state
  const[rotateAnim,setRotateAnim]=useState(null); // {type:'row'|'col', idx, dir}
  const[rotateCount,setRotateCount]=useState(0);
  const[rotateActive,setRotateActive]=useState(false); // toggle: false=word mode, true=rotate mode

  // Theme mode state
  const[activeTheme,setActiveTheme]=useState(null); // {name, words}
  const[themeFound,setThemeFound]=useState([]); // theme words found

  // Bomb mode state
  const[bombCell,setBombCell]=useState(null); // {r,c}
  const[bombTimer,setBombTimer]=useState(0);

  // Mystery mode state
  const[mysteryCell,setMysteryCell]=useState(null); // {r,c}
  const[mysteryRevealed,setMysteryRevealed]=useState(false);

  // Chess mode state
  const[chessPiece,setChessPiece]=useState(null); // 'pawn','rook','bishop','knight','queen'
  const[chessPos,setChessPos]=useState(null); // {r,c} current piece position
  const[chessPath,setChessPath]=useState([]); // [{r,c},...] cells visited
  const[chessWord,setChessWord]=useState(""); // word being built
  const[chessValidCells,setChessValidCells]=useState([]); // valid move targets
  const[chessInvalid,setChessInvalid]=useState(null); // {r,c,t} for invalid move flash
  const[chessMoves,setChessMoves]=useState(0); // total moves this game
  const[chessAnimFrom,setChessAnimFrom]=useState(null); // {r,c} previous position for move animation
  const[chessGrid,setChessGrid]=useState([]); // separate 8×8 grid for chess mode
  const[chessPlacing,setChessPlacing]=useState(true); // true = placing piece phase
  const CHESS_SZ=8;

  const[state,setState]=useState("menu");
  const[grid,setGrid]=useState([]);
  const[valid,setValid]=useState(new Set());
  const[found,setFound]=useState([]);
  const[sel,setSel]=useState([]);
  const[dragging,setDragging]=useState(false);
  const[word,setWord]=useState("");
  const[time,setTime]=useState(gameTime);
  const[score,setScore]=useState(0);
  const[msg,setMsg]=useState(null);
  const[shake,setShake]=useState(false);
  const[popups,setPopups]=useState([]);
  const[wordPopups,setWordPopups]=useState([]);
  const[combo,setCombo]=useState(0);
  const[lastFoundTime,setLastFoundTime]=useState(0);
  const[flashKey,setFlashKey]=useState(0);
  const[scrambleGrid,setScrambleGrid]=useState(null); // grid of random letters shown during scramble
  const[scrambleStep,setScrambleStep]=useState(0); // how many letters have "settled" into final position
  const[scrambleStyle,setScrambleStyle]=useState("random"); // intro animation variant
  const[settledCells,setSettledCells]=useState(new Set()); // which cells have settled during wave/spiral/rain
  // Solo nickname for hall of fame
  const[soloNickname,setSoloNickname]=useState(()=>{
    try{const a=JSON.parse(localStorage.getItem("piilosana_auth")||"null");if(a?.nickname)return a.nickname;}catch{}
    return localStorage.getItem("piilosana_nick")||"";
  });
  const[hofSubmitted,setHofSubmitted]=useState(false);
  // Ending
  const[ending,setEnding]=useState(null);
  const[endingProgress,setEndingProgress]=useState(0);
  const[eatenCells,setEatenCells]=useState(new Set());
  // Multiplayer states
  const[mode,setMode]=useState(null);
  const[socket,setSocket]=useState(null);
  const[roomCode,setRoomCode]=useState("");
  const[pendingDeepLink,setPendingDeepLink]=useState(()=>{
    const p=new URLSearchParams(window.location.search);
    if(p.has("arena"))return{type:"arena"};
    if(p.get("room"))return{type:"room",code:p.get("room").toUpperCase()};
    return null;
  });
  const[nickname,setNickname]=useState(()=>{
    try{const a=JSON.parse(localStorage.getItem("piilosana_auth")||"null");if(a?.nickname)return a.nickname;}catch{}
    return "";
  });
  // Sync nicknames when authUser changes
  useEffect(()=>{
    if(authUser?.nickname){
      setNickname(authUser.nickname);
      setSoloNickname(authUser.nickname);
      localStorage.setItem("piilosana_nick",authUser.nickname);
    }
  },[authUser]);
  // Deep link handling: ?arena or ?room=XXXX
  useEffect(()=>{
    if(!pendingDeepLink)return;
    // Clean URL without reload
    window.history.replaceState({},"",window.location.pathname);
    if(pendingDeepLink.type==="arena"){
      setMode("public");
      if(authUser){setPublicState("waiting");}else{setPublicState("nickname");}
    }else if(pendingDeepLink.type==="room"){
      setMode("multi");
      if(authUser){setNickname(authUser.nickname);setLobbyState("choose");}else{setLobbyState("enter_name");}
      setRoomCode(pendingDeepLink.code);
    }
    setPendingDeepLink(null);
  },[]);

  const[players,setPlayers]=useState([]);
  const[playerId,setPlayerId]=useState(null);
  const[isHost,setIsHost]=useState(false);
  const[multiScores,setMultiScores]=useState([]);
  const[multiRankings,setMultiRankings]=useState(null);
  const[lobbyState,setLobbyState]=useState("enter_name");
  const[lobbyError,setLobbyError]=useState("");
  const[linkCopied,setLinkCopied]=useState(false);
  const[showSharePopup,setShowSharePopup]=useState(false);
  const[socketConnected,setSocketConnected]=useState(false);
  const[publicRooms,setPublicRooms]=useState([]);
  const[currentMultiGrid,setCurrentMultiGrid]=useState([]);
  const[countdown,setCountdown]=useState(0);
  const[multiValidWords,setMultiValidWords]=useState([]);
  const[multiAllFoundWords,setMultiAllFoundWords]=useState({});
  // Battle mode states
  const[otherSelections,setOtherSelections]=useState({}); // {playerId: {nickname, cells}}
  const[battleMsg,setBattleMsg]=useState(null); // {word, finder, points} - flash when someone finds
  const[emojiFeed,setEmojiFeed]=useState([]); // [{id, nickname, emoji, fading}]
  const emojiFeedIdRef=useRef(0);
  const[emojiOpen,setEmojiOpen]=useState(false); // false | "open" | "closing"
  const[chatHidden,setChatHidden]=useState(false); // hide glass chat overlay
  const closeEmojiPicker=useCallback(()=>{
    setEmojiOpen("closing");
    setTimeout(()=>setEmojiOpen(false),250);
  },[]);
  // Public game (Piilosauna)
  const[publicState,setPublicState]=useState(null); // null|'waiting'|'countdown'|'playing'|'end'
  const[publicScores,setPublicScores]=useState([]);
  const[publicPlayerCount,setPublicPlayerCount]=useState(0);
  const[publicRankings,setPublicRankings]=useState(null);
  const[publicRound,setPublicRound]=useState(0);
  const[publicAllFound,setPublicAllFound]=useState([]);
  const[publicCountdown,setPublicCountdown]=useState(5);
  const[publicNextCountdown,setPublicNextCountdown]=useState(0);
  const[publicOnlineCount,setPublicOnlineCount]=useState(0);
  const[publicHex,setPublicHex]=useState(false);

  // Poll arena player count from REST API when on main menu
  useEffect(()=>{
    if(mode!==null)return;
    let active=true;
    const poll=async()=>{
      try{const r=await fetch(`${SERVER_URL}/api/arena-count`);const d=await r.json();if(active)setPublicOnlineCount(prev=>prev===d.count?prev:d.count);}catch{}
    };
    poll();
    const iv=setInterval(poll,10000);
    return()=>{active=false;clearInterval(iv);};
  },[mode]);

  const gRef=useRef(null);
  const wordBarRef=useRef(null);
  const tRef=useRef(null);
  const nicknameRef=useRef(null);
  const popupIdRef=useRef(0);
  const lastSubmittedWordRef=useRef("");
  const foundRef=useRef([]);

  // Keep foundRef in sync with found state (avoids stale closure in socket handlers)
  useEffect(()=>{foundRef.current=found;},[found]);

  // Show settings bubble briefly on main menu
  useEffect(()=>{
    if(mode!==null){setSettingsBubble(false);setBubbleFading(false);setFlagBubble(false);setFlagBubbleFading(false);return;}
    const shown=sessionStorage.getItem("piilosana_bubble_shown");
    if(shown)return;
    const t1=setTimeout(()=>setSettingsBubble(true),2000);
    const t2=setTimeout(()=>setBubbleFading(true),6000);
    const t3=setTimeout(()=>{setSettingsBubble(false);setBubbleFading(false);sessionStorage.setItem("piilosana_bubble_shown","1");},7000);
    const flagShown=sessionStorage.getItem("piilosana_flag_bubble_shown");
    const t4=flagShown?null:setTimeout(()=>setFlagBubble(true),8500);
    const t5=flagShown?null:setTimeout(()=>setFlagBubbleFading(true),12500);
    const t6=flagShown?null:setTimeout(()=>{setFlagBubble(false);setFlagBubbleFading(false);sessionStorage.setItem("piilosana_flag_bubble_shown","1");},13500);
    return()=>{clearTimeout(t1);clearTimeout(t2);clearTimeout(t3);if(t4)clearTimeout(t4);if(t5)clearTimeout(t5);if(t6)clearTimeout(t6);};
  },[mode]);

  // (arena count polling handled above via /api/arena-count)


  const addPopup=useCallback((text,color,x,y)=>{
    let px=x,py=y;
    if(px===undefined||py===undefined){
      const el=gRef.current||wordBarRef.current;
      if(el){const r=el.getBoundingClientRect();px=r.left+r.width/2;py=r.top+r.height/2;}
      else{px=window.innerWidth/2;py=window.innerHeight/2;}
    }
    const id=++popupIdRef.current;
    setPopups(p=>[...p,{id,text,color,x:px,y:py}]);
    setTimeout(()=>setPopups(p=>p.filter(pp=>pp.id!==id)),1100);
  },[]);

  const addWordPopup=useCallback((word,color,x,y)=>{
    let px=x,py=y;
    if(px===undefined||py===undefined){
      const el=wordBarRef.current||gRef.current;
      if(el){const r=el.getBoundingClientRect();px=r.left+r.width/2;py=r.top;}
      else{px=window.innerWidth/2;py=window.innerHeight/3;}
    }
    const id=++popupIdRef.current;
    setWordPopups(p=>[...p,{id,text:word.toUpperCase(),color,x:px,y:py}]);
    const popDuration=word.length>=10?2000:word.length>=8?1600:1300;
    setTimeout(()=>setWordPopups(p=>p.filter(pp=>pp.id!==id)),popDuration);
  },[]);

  const startSolo=useCallback(async(overrideMode,overrideTime)=>{
    // Ensure word list is loaded before starting
    if(!LANG_CONFIG[lang].loaded){await loadWords(lang);setWordsLoaded(p=>({...p,[lang]:true}));}
    sounds.init().catch(()=>{});
    const gt=overrideTime!==undefined?overrideTime:gameTime;
    const sm=overrideMode!==undefined?overrideMode:soloMode;
    let bg=null,bw=new Set();
    for(let i=0;i<50;i++){const g=sm==="hex"?makeGrid(HEX_ROWS,lang,HEX_COLS):makeGrid(SZ,lang);const w=(sm==="hex"?findWordsHex:findWords)(g,trie);if(w.size>bw.size){bg=g;bw=w;}if(w.size>=(sm==="hex"?25:15))break;}
    setGrid(bg);setValid(bw);setFound([]);setSel([]);setWord("");setTime(gt);setScore(0);setMsg(null);
    // Fetch long words (11-15 chars) from server in background
    if(lang==="fi"&&bg){fetch(`${SERVER_URL}/api/find-long-words`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({grid:bg,hex:sm==="hex"})}).then(r=>r.json()).then(({words})=>{if(words&&words.length>0)setValid(prev=>{const n=new Set(prev);words.forEach(w=>n.add(w));return n;});}).catch(()=>{});}
    setEatenCells(new Set());setCombo(0);setLastFoundTime(0);setPopups([]);setWordPopups([]);
    setEnding(null);setEndingProgress(0);setDropKey(0);

    // Mode-specific initialization
    if(sm==="rotate"){setRotateAnim(null);setRotateCount(0);setRotateActive(false);}
    if(sm==="theme"){
      const themes=WORD_THEMES[lang]||WORD_THEMES.fi;
      const theme=themes[Math.floor(Math.random()*themes.length)];
      // Filter to words that exist in trie and are in valid set
      const validThemeWords=theme.words.filter(w=>bw.has(w));
      setActiveTheme({name:theme.name,emoji:theme.emoji,words:validThemeWords.length>0?validThemeWords:theme.words});
      setThemeFound([]);
    }else{setActiveTheme(null);setThemeFound([]);}
    if(sm==="bomb"){
      setBombCell(pickBombCell(SZ));setBombTimer(15);
    }else{setBombCell(null);setBombTimer(0);}
    if(sm==="mystery"){
      setMysteryCell(pickMysteryCell(SZ));setMysteryRevealed(false);
    }else{setMysteryCell(null);setMysteryRevealed(false);}
    if(sm==="chess"){
      const piece=randomChessPiece();
      // Generate 8×8 grid
      const cg=makeGrid(8,lang);
      setChessGrid(cg);
      setChessPiece(piece);setChessPos(null);
      setChessPath([]);setChessWord("");
      setChessValidCells([]);
      setChessInvalid(null);setChessMoves(0);setChessPlacing(true);
    }else{setChessPiece(null);setChessPos(null);setChessPath([]);setChessWord("");setChessValidCells([]);setChessInvalid(null);setChessMoves(0);setChessGrid([]);setChessPlacing(false);}

    setMode("solo");setCountdown(3);setState("countdown");
    if(overrideMode!==undefined)setSoloMode(overrideMode);
    if(overrideTime!==undefined)setGameTime(overrideTime);
    window.scrollTo(0,0);
  },[trie,sounds,gameTime,soloMode,lang]);

  const[dailyDate,setDailyDate]=useState(todayStr()); // which date's daily we're playing
  const startDaily=useCallback(async(forDate)=>{
    const playDate=forDate||todayStr();
    if(getDailyResultForDate(playDate,lang))return; // already played this date
    // Only allow today and past 6 days (compare in Finnish timezone)
    const today=todayStr();
    const dayDiff=Math.floor((new Date(today+"T12:00:00Z").getTime()-new Date(playDate+"T12:00:00Z").getTime())/(86400000));
    if(dayDiff<0)return; // can't play future
    if(dayDiff>6)return; // too old
    if(!LANG_CONFIG[lang].loaded){await loadWords(lang);setWordsLoaded(p=>({...p,[lang]:true}));}
    sounds.init().catch(()=>{});
    // Pick today's theme deterministically
    const theme=getDailyTheme(playDate,lang);
    // Generate grids, prefer ones with more theme words (while still ensuring good total word count)
    let bg=null,bw=new Set(),bestThemeCount=0;
    for(let i=0;i<50;i++){
      const rng=seededRng(dailySeed(playDate+lang+i));
      const g=makeGrid(7,lang,5,rng);
      const w=findWordsHex(g,trie);
      const tc=countThemeWords(w,theme);
      // Prefer grids with more theme words, but require decent total word count
      if(w.size>=15&&(tc>bestThemeCount||(tc===bestThemeCount&&w.size>bw.size))){bg=g;bw=w;bestThemeCount=tc;}
      else if(!bg&&w.size>bw.size){bg=g;bw=w;}
      if(w.size>=25&&tc>=5)break;
    }
    if(!bg){const rng=seededRng(dailySeed(playDate+lang));bg=makeGrid(7,lang,5,rng);bw=findWordsHex(bg,trie);}
    setDailyTheme(theme);
    setGrid(bg);setValid(bw);setFound([]);setSel([]);setWord("");setTime(180);setScore(0);setMsg(null);
    setEatenCells(new Set());setCombo(0);setLastFoundTime(0);setPopups([]);setWordPopups([]);
    setEnding(null);setEndingProgress(0);setDropKey(0);
    setActiveTheme(null);setThemeFound([]);setBombCell(null);setBombTimer(0);
    setMysteryCell(null);setMysteryRevealed(false);
    setChessPiece(null);setChessPos(null);setChessPath([]);setChessWord("");setChessValidCells([]);setChessInvalid(null);setChessMoves(0);setChessGrid([]);setChessPlacing(false);
    setDailyMode(true);setDailyDate(playDate);setDailyThemeFound([]);setDailyThemeBonusGiven(false);
    setSoloMode("hex");setGameTime(180);
    setMode("solo");setCountdown(3);setState("countdown");
    window.scrollTo(0,0);
    if(lang==="fi"&&bg){fetch(`${SERVER_URL}/api/find-long-words`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({grid:bg,hex:true})}).then(r=>r.json()).then(({words})=>{if(words&&words.length>0)setValid(prev=>{const n=new Set(prev);words.forEach(w=>n.add(w));return n;});}).catch(()=>{});}
  },[trie,sounds,lang]);

  const shareDailyResult=useCallback(()=>{
    const dr=getDailyResult(lang)||getDailyResultForDate(dailyDate,lang);if(!dr)return;
    const dl=dateLabel(dr.date,lang);
    const pct=dr.totalWords>0?Math.round(dr.wordsFound/dr.totalWords*100):0;
    const streak=getDailyStreak(lang);
    const themeStr=dailyTheme?` (${dailyTheme.name})`:"";
    const bonusStr=dailyThemeBonusGiven?` 🎯 Teemabonus +${DAILY_THEME_BONUS}p!`:"";
    const text=`Sain ${dl.full} Sanapiilossa${themeStr} ${dr.score} pistettä (${dr.wordsFound}/${dr.totalWords} sanaa)!${bonusStr} Pystytkö parempaan?${streak.streak>1?` 🔥 ${streak.streak} päivää putkeen!`:""}\n\nPelaa: https://piilosana.com`;
    if(navigator.share){navigator.share({title:`Päivän Sanapiilo – ${dl.full}`,text}).catch(()=>{});}
    else{navigator.clipboard.writeText(text).then(()=>setDailyShareMsg(t.dailyCopied)).catch(()=>{});setTimeout(()=>setDailyShareMsg(null),2000);}
  },[t,lang,dailyDate,dailyTheme,dailyThemeBonusGiven]);

  const start=useCallback(async()=>{
    if(mode==="solo"){
      await startSolo();
    }
  },[mode,startSolo]);

  // Countdown timer (shared for solo + multi)
  useEffect(()=>{
    if(state!=="countdown")return;
    if(countdown<=0){
      if(mode==="public"){sounds.playGo();setState("play");return;}
      {const styles=["random","wave","rain","spiral","scatter"];setScrambleStyle(styles[Math.floor(Math.random()*styles.length)]);}
      setSettledCells(new Set());setState("scramble");setScrambleStep(0);setScrambleGrid(soloMode==="hex"?makeGrid(HEX_ROWS,lang,HEX_COLS):makeGrid(soloMode==="chess"?8:SZ,lang));return;
    }
    sounds.playCountdown(countdown);
    const t=setTimeout(()=>setCountdown(c=>c-1),1000);
    return()=>clearTimeout(t);
  },[state,countdown,sounds]);

  // Scramble animation — letters randomize then settle into final grid
  useEffect(()=>{
    if(state!=="scramble")return;
    const isHex=soloMode==="hex"||mode==="multi"||publicHex||(mode==="public");
    const rows=isHex?HEX_ROWS:soloMode==="chess"?8:SZ;
    const cols=isHex?HEX_COLS:soloMode==="chess"?8:SZ;
    const totalCells=rows*cols;
    const mkRand=()=>isHex?makeGrid(HEX_ROWS,lang,HEX_COLS):makeGrid(rows,lang,cols!==rows?cols:undefined);
    const style=scrambleStyle;

    if(style==="random"){
      // Classic: all letters randomize together, then snap
      let step=0;
      const interval=setInterval(()=>{
        step++;
        if(step<=10){
          setScrambleGrid(mkRand());
        }else{
          clearInterval(interval);
          sounds.playGo();
          setScrambleGrid(null);setScrambleStep(0);setSettledCells(new Set());
          setState("play");
        }
      },70);
      return()=>clearInterval(interval);
    }

    if(style==="wave"||style==="rain"||style==="spiral"||style==="scatter"){
      // Phase 1: randomize all cells (400ms), Phase 2: settle cells progressively
      let step=0;
      const scrambleFrames=6;
      // Build settle order based on style
      const cellOrder=[];
      for(let r=0;r<rows;r++)for(let c=0;c<cols;c++)cellOrder.push({r,c,idx:r*cols+c});
      if(style==="wave"){
        cellOrder.sort((a,b)=>a.c-b.c||(a.c%2===0?a.r-b.r:b.r-a.r));
      }else if(style==="rain"){
        cellOrder.sort((a,b)=>a.r-b.r||a.c-b.c);
      }else if(style==="spiral"){
        const cr=(rows-1)/2,cc=(cols-1)/2;
        cellOrder.sort((a,b)=>{const da=Math.sqrt((a.r-cr)**2+(a.c-cc)**2);const db=Math.sqrt((b.r-cr)**2+(b.c-cc)**2);return da-db;});
      }else{
        // scatter: random order
        for(let i=cellOrder.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[cellOrder[i],cellOrder[j]]=[cellOrder[j],cellOrder[i]];}
      }
      // Group cells into ~6-8 batches
      const batchCount=Math.min(8,Math.ceil(totalCells/4));
      const batchSize=Math.ceil(totalCells/batchCount);

      const settled=new Set();
      const interval=setInterval(()=>{
        step++;
        if(step<=scrambleFrames){
          setScrambleGrid(mkRand());
        }else{
          const settleStep=step-scrambleFrames;
          const settleEnd=Math.min(settleStep*batchSize,totalCells);
          for(let i=0;i<settleEnd;i++)settled.add(cellOrder[i].idx);
          setSettledCells(new Set(settled));
          setScrambleGrid(mkRand());
          if(settleEnd>=totalCells){
            clearInterval(interval);
            sounds.playGo();
            setScrambleGrid(null);setScrambleStep(0);setSettledCells(new Set());
            setState("play");
          }
        }
      },70);
      return()=>clearInterval(interval);
    }
  },[state,lang,sounds,scrambleStyle]);

  // Timer (solo mode only — multiplayer uses server timer_tick + game_over)
  const startTimeRef=useRef(null);
  const soundsRef=useRef(sounds);
  soundsRef.current=sounds;
  const themeIdRef=useRef(themeId);
  themeIdRef.current=themeId;
  useEffect(()=>{
    if(state!=="play"||mode==="multi"||mode==="public"||gameTime===0)return;
    startTimeRef.current=Date.now();
    let lastSecond=gameTime;
    tRef.current=setInterval(()=>{
      const elapsed=Math.floor((Date.now()-startTimeRef.current)/1000);
      const remaining=Math.max(0,gameTime-elapsed);
      setTime(remaining);
      if(remaining!==lastSecond){
        lastSecond=remaining;
        if(remaining<=15&&remaining>0)soundsRef.current.playTick(remaining);
      }
      if(remaining<=0){
        clearInterval(tRef.current);
        // Pick random ending
        const e=ENDINGS[Math.floor(Math.random()*ENDINGS.length)];
        setEnding(e);
        soundsRef.current.playEnding();
        setState("ending");
      }
    },200);
    return()=>clearInterval(tRef.current);
  },[state,mode,gameTime,soloMode]);

  // Ending animation (solo + multi) — now with scramble phase
  useEffect(()=>{
    if(state!=="ending")return;
    let progress=0;
    let scrambleCount=0;
    // Phase 0: scramble letters (progress 0-0.25, ~0.7s)
    // Phase 1: show name/emoji big (progress 0.25-0.45, ~0.6s) - no cells eaten yet
    // Phase 2: cells start disappearing (progress 0.45-1.0, ~1.5s)
    // Phase 3: linger (1.0-1.3) then end (~0.5s)
    const t=setInterval(()=>{
      progress+=0.04;
      setEndingProgress(progress);
      // Phase 0: scramble letters rapidly
      if(progress<=0.25){
        scrambleCount++;
        setScrambleGrid(soloMode==="hex"?makeGrid(HEX_ROWS,lang,HEX_COLS):makeGrid(soloMode==="chess"?8:SZ,lang));
        setScrambleStep(0);
      }else if(progress>0.25&&scrambleCount>0){
        // End scramble phase — clear it
        setScrambleGrid(null);setScrambleStep(0);
        scrambleCount=0;
      }
      // Phase 2: start eating cells
      if(progress>0.45){
        const eatProgress=(progress-0.45)/0.55; // 0 to 1
        const isHex=soloMode==="hex"||mode==="multi"||(mode==="public"&&publicHex);
        const totalCells=isHex?HEX_ROWS*HEX_COLS:(soloMode==="chess"?8*8:SZ*SZ);
        const cellCount=Math.min(totalCells, Math.floor(eatProgress * totalCells));
        setEatenCells(prev=>{
          const n=new Set(prev);
          for(let i=0;i<cellCount;i++) n.add(i);
          return n;
        });
        if(eatProgress>0.05) soundsRef.current.playChomp();
      }
      if(progress>=1.3){
        clearInterval(t);
        setState("end");
        if(mode==="multi")setLobbyState("results");
        if(mode==="public")setPublicState("end");
        // daily save handled in separate useEffect
      }
    },80);
    return()=>clearInterval(t);
  },[state,mode]);

  // Save daily result when game ends — local + server
  useEffect(()=>{
    if(state==="end"&&dailyMode&&!getDailyResultForDate(dailyDate,lang)){
      saveDailyResult(score,found.length,valid.size,dailyDate,lang);
      if(dailyDate===todayStr())updateDailyStreak(lang);
      setDailyResult(getDailyResult(lang));
      // Submit to server daily leaderboard
      const nick=authUser?.nickname||(()=>{try{const a=JSON.parse(localStorage.getItem("piilosana_auth")||"null");if(a?.nickname)return a.nickname;}catch{}return localStorage.getItem('piilosana_nick')||'Anon';})();
      fetch('/api/daily-scores',{method:'POST',headers:{'Content-Type':'application/json'},
        body:JSON.stringify({nickname:nick,score,wordsFound:found.length,wordsTotal:valid.size,dateStr:dailyDate,lang})
      }).catch(()=>{});
    }
  },[state,dailyMode,score,found,valid,dailyDate]);


  // Bomb mode timer
  useEffect(()=>{
    if(state!=="play"||soloMode!=="bomb"||!bombCell)return;
    const iv=setInterval(()=>{
      setBombTimer(t=>{
        if(t<=1){
          // BOOM! Scramble area around bomb
          setGrid(g=>{
            const ng=scrambleArea(g,bombCell.r,bombCell.c,1,lang);
            const nv=(soloMode==="hex"?findWordsHex:findWords)(ng,trie);
            setValid(nv);
            return ng;
          });
          addPopup(T[lang]?.bombExploded||"💥","#ff4444");
          setScore(s=>Math.max(0,s-5));
          sounds.playWrong();
          // New bomb
          setBombCell(pickBombCell(SZ));
          return 15;
        }
        if(t<=5)sounds.playTick();
        return t-1;
      });
    },1000);
    return()=>clearInterval(iv);
  },[state,soloMode,bombCell,lang,trie,sounds,addPopup]);

  // Rotate mode: drag on grid cells to rotate row/column when rotateActive
  const rotateDragRef=useRef(null);
  useEffect(()=>{
    if(state!=="play"||soloMode!=="rotate"||!rotateActive)return;
    const gridEl=gRef.current;
    if(!gridEl)return;
    const THRESHOLD=25;
    const onDown=(e)=>{
      e.preventDefault();
      // Find which cell was touched
      const cell=e.target.closest("[data-c]");
      if(!cell)return;
      const[rr,cc]=cell.dataset.c.split(",").map(Number);
      const px=e.touches?e.touches[0].clientX:e.clientX;
      const py=e.touches?e.touches[0].clientY:e.clientY;
      rotateDragRef.current={row:rr,col:cc,startX:px,startY:py,done:false};
    };
    const onMove=(e)=>{
      const d=rotateDragRef.current;
      if(!d||d.done)return;
      e.preventDefault();
      const px=e.touches?e.touches[0].clientX:e.clientX;
      const py=e.touches?e.touches[0].clientY:e.clientY;
      const dx=px-d.startX,dy=py-d.startY;
      // Determine if horizontal (row rotate) or vertical (col rotate)
      if(Math.abs(dx)>THRESHOLD&&Math.abs(dx)>Math.abs(dy)){
        d.done=true;
        const dir=dx>0?1:-1;
        setRotateAnim({type:"row",idx:d.row,dir});
        sounds.playSlide();
        setTimeout(()=>{
          setGrid(g=>{
            const ng=rotateRow(g,d.row,dir);
            const nv=(soloMode==="hex"?findWordsHex:findWords)(ng,trie);setValid(nv);
            return ng;
          });
          setRotateCount(n=>n+1);setRotateAnim(null);
        },300);
      }else if(Math.abs(dy)>THRESHOLD&&Math.abs(dy)>Math.abs(dx)){
        d.done=true;
        const dir=dy>0?1:-1;
        setRotateAnim({type:"col",idx:d.col,dir});
        sounds.playSlide();
        setTimeout(()=>{
          setGrid(g=>{
            const ng=rotateCol(g,d.col,dir);
            const nv=(soloMode==="hex"?findWordsHex:findWords)(ng,trie);setValid(nv);
            return ng;
          });
          setRotateCount(n=>n+1);setRotateAnim(null);
        },300);
      }
    };
    const onUp=()=>{rotateDragRef.current=null;};
    const onCtx=(e)=>{e.preventDefault();}; // block right-click menu
    gridEl.addEventListener("pointerdown",onDown,{passive:false});
    gridEl.addEventListener("pointermove",onMove,{passive:false});
    gridEl.addEventListener("pointerup",onUp);
    gridEl.addEventListener("pointercancel",onUp);
    gridEl.addEventListener("touchstart",onDown,{passive:false});
    gridEl.addEventListener("touchmove",onMove,{passive:false});
    gridEl.addEventListener("touchend",onUp);
    gridEl.addEventListener("contextmenu",onCtx);
    return()=>{
      gridEl.removeEventListener("pointerdown",onDown);
      gridEl.removeEventListener("pointermove",onMove);
      gridEl.removeEventListener("pointerup",onUp);
      gridEl.removeEventListener("pointercancel",onUp);
      gridEl.removeEventListener("touchstart",onDown);
      gridEl.removeEventListener("touchmove",onMove);
      gridEl.removeEventListener("touchend",onUp);
      gridEl.removeEventListener("contextmenu",onCtx);
    };
  },[state,soloMode,rotateActive,trie,sounds]);

  // Chess mode: is cell on bottom row (placing zone)?
  const isBottomRow=useCallback((r)=>{
    return r===CHESS_SZ-1;
  },[]);

  // Chess mode: handle cell click
  const chessClickCell=useCallback((r,c)=>{
    if(state!=="play"||soloMode!=="chess"||!chessPiece)return;
    // Placing phase: must click an edge cell
    if(chessPlacing){
      if(!isBottomRow(r)){
        setChessInvalid({r,c,t:Date.now()});
        sounds.playWrong();
        setTimeout(()=>setChessInvalid(null),400);
        return;
      }
      // Place piece on this edge cell
      setChessPos({r,c});
      setChessPath([{r,c}]);
      setChessWord(chessGrid[r]?.[c]||"");
      setChessValidCells(chessValidMoves(chessPiece,r,c,CHESS_SZ));
      setChessPlacing(false);
      setChessMoves(0);
      setChessAnimFrom(null);
      sounds.playChessPlace();
      return;
    }
    // Clicking current position — ignore (use undo button to go back)
    if(chessPos&&r===chessPos.r&&c===chessPos.c){
      return;
    }
    // Check if this is a valid move
    const isValid=chessValidCells.some(m=>m.r===r&&m.c===c);
    if(!isValid){
      setChessInvalid({r,c,t:Date.now()});
      sounds.playWrong();
      setTimeout(()=>setChessInvalid(null),400);
      return;
    }
    // Already visited? not allowed
    if(chessPath.some(p=>p.r===r&&p.c===c)){
      setChessInvalid({r,c,t:Date.now()});
      sounds.playWrong();
      setTimeout(()=>setChessInvalid(null),400);
      return;
    }
    // Move piece — trigger animation from old position
    const oldPos={...chessPos};
    const newPath=[...chessPath,{r,c}];
    const newWord=chessWord+(chessGrid[r]?.[c]||"");
    setChessAnimFrom(oldPos);
    setChessPos({r,c});
    setChessPath(newPath);
    setChessWord(newWord);
    setChessValidCells(chessValidMoves(chessPiece,r,c,CHESS_SZ));
    setChessMoves(m=>m+1);
    sounds.playChessMove();
    // Clear animation after it completes
    setTimeout(()=>setChessAnimFrom(null),280);
  },[state,soloMode,chessPiece,chessValidCells,chessPath,chessWord,chessGrid,chessPlacing,chessPos,isBottomRow,sounds]);

  // Chess mode: undo last move (or go back to placing if only 1 step)
  const chessUndo=useCallback(()=>{
    if(soloMode!=="chess"||chessPath.length<1)return;
    if(chessPath.length===1){
      // Undo placement — go back to placing phase
      setChessPos(null);
      setChessPath([]);
      setChessWord("");
      setChessValidCells([]);
      setChessPlacing(true);
      setChessAnimFrom(null);
      return;
    }
    const newPath=chessPath.slice(0,-1);
    const lastPos=newPath[newPath.length-1];
    const newWord=newPath.map(p=>chessGrid[p.r]?.[p.c]||"").join("");
    setChessPos(lastPos);
    setChessPath(newPath);
    setChessWord(newWord);
    setChessValidCells(chessValidMoves(chessPiece,lastPos.r,lastPos.c,CHESS_SZ));
    setChessMoves(m=>Math.max(0,m-1));
    setChessAnimFrom(null);
  },[soloMode,chessPath,chessGrid,chessPiece]);

  // Chess mode: submit current word
  const chessSubmitWord=useCallback(()=>{
    if(soloMode!=="chess"||chessWord.length<3)return;
    const isValidWord=WORDS_SET.has(chessWord);
    const alreadyFound=found.includes(chessWord);
    if(isValidWord&&!alreadyFound){
      const mult=CHESS_MULT[chessPiece]||1;
      let p=letterMult?ptsLetters(chessWord,lang):pts(chessWord.length);
      p=Math.round(p*mult);
      setScore(s=>s+p);setFound(f=>[...f,chessWord]);
      setMsg({t:chessWord,ok:true,p});
      setFlashKey(k=>k+1);
      sounds.playByLength(chessWord.length);
      addPopup(`${chessWord.toUpperCase()} +${p} ${CHESS_EMOJI[chessPiece]}`,wordColor());
    }else if(alreadyFound){
      setMsg({t:chessWord,ok:false,m:"Jo löydetty!"});setShake(true);setTimeout(()=>setShake(false),400);sounds.playWrong();
    }else{
      setMsg({t:chessWord,ok:false,m:T[lang]?.notValid||"Ei kelpaa"});setShake(true);setTimeout(()=>setShake(false),400);sounds.playWrong();
    }
    // Reset: new piece, go to placing phase
    const piece=randomChessPiece();
    setChessPiece(piece);setChessPos(null);
    setChessPath([]);setChessWord("");
    setChessValidCells([]);setChessPlacing(true);
  },[soloMode,chessWord,chessPiece,found,sounds,addPopup,letterMult,lang]);

  // Chess mode: reset current path (skip this piece)
  const chessReset=useCallback(()=>{
    if(soloMode!=="chess")return;
    const piece=randomChessPiece();
    setChessPiece(piece);setChessPos(null);
    setChessPath([]);setChessWord("");
    setChessValidCells([]);setChessPlacing(true);
  },[soloMode]);

  // Track achievements when game ends
  useEffect(()=>{
    if(state!=="end")return;
    const wordsFound=found.length;
    if(wordsFound===0&&score===0)return; // no-op game
    const longestFound=found.reduce((max,w)=>Math.max(max,w.length),0);
    // Use actual elapsed time if available, fall back to gameTime setting
    const actualElapsed=startTimeRef.current?Math.max(1,Math.floor((Date.now()-startTimeRef.current)/1000)):null;
    const gameTimeSec=gameTime===0?(actualElapsed||60):(actualElapsed||gameTime||120);
    const wordsPerMin=gameTimeSec>0?Math.round(wordsFound/(gameTimeSec/60)*10)/10:0;
    // Count 6+ letter words found this game
    const longWordsThisGame=found.filter(w=>w.length>=6).length;
    // Perfect game check (solo non-unlimited only)
    const isPerfect=mode==="solo"&&gameTime!==0&&soloMode==="normal"&&valid.size>0&&wordsFound>=valid.size;
    // Daily games tracking
    const today=new Date().toISOString().slice(0,10);
    const updates={addWords:wordsFound,addGames:1,bestScore:score,longestWord:longestFound,bestWordsPerMin:wordsPerMin,
      langsPlayed:[lang],addLongWords:longWordsThisGame};
    if(isPerfect)updates.addPerfect=1;
    // Day tracking
    updates.dayDate=today;
    if(mode==="public"){
      updates.addArenaGames=1;
      if(publicRankings&&publicRankings.length>0){
        const myNick=(authUser?.nickname||nickname||"").toUpperCase();
        if(publicRankings[0]?.nickname?.toUpperCase()===myNick)updates.addArenaWins=1;
      }
    }
    updateAchStats(updates);
  },[state]);

  // Track combo achievements during play
  const achComboRef=useRef(0);
  useEffect(()=>{
    if(combo>achComboRef.current)achComboRef.current=combo;
    if(state==="end"&&achComboRef.current>0){
      const c=achComboRef.current;
      achComboRef.current=0;
      setAchStats(prev=>{
        if(c>prev.bestCombo){
          const next={...prev,bestCombo:c};
          localStorage.setItem("piilosana_ach_stats",JSON.stringify(next));
          achStatsRef.current=next;
          checkAchievements(next);
          return next;
        }
        return prev;
      });
    }
  },[combo,state,checkAchievements]);

  // Cell detection - astroid hitbox clipped to cell bounds + adjacency bias.
  // Astroid |dx|^⅔+|dy|^⅔ ≤ (w/2)^⅔ with cusps at cell edges.
  // Large diagonal dead zones prevent accidental cross-picks during diagonal swipes.
  const cellAt=useCallback((x,y,lastCell)=>{
    if(!gRef.current)return null;
    let best=null,bestDist=Infinity;
    for(const el of gRef.current.querySelectorAll("[data-c]")){
      const rect=el.getBoundingClientRect();
      const cx=rect.left+rect.width/2,cy=rect.top+rect.height/2;
      const dx=Math.abs(x-cx),dy=Math.abs(y-cy);
      const hw=rect.width/2,hh=rect.height/2;
      if(dx>hw||dy>hh)continue;
      // Hex hit-test for polygon(50% 0%,100% 25%,100% 75%,50% 100%,0% 75%,0% 25%)
      // From center: nx=dx/hw (0..1), ny=dy/hh (0..1)
      // Flat sides at nx=1 (when ny≤0.5), diagonal edges when ny>0.5: nx ≤ 2*(1-ny)
      const nx=dx/hw,ny=dy/hh;
      const inHex=ny<=0.5?(nx<=1):(nx<=2*(1-ny));
      if(!inHex)continue;
      const dist=dx*dx+dy*dy;
      const[row,col]=el.dataset.c.split(",").map(Number);
      let score=dist;
      if(lastCell&&(Math.abs(row-lastCell.r)>1||Math.abs(col-lastCell.c)>1))score+=hw*hw*2;
      if(score<bestDist){best={r:row,c:col};bestDist=score;}
    }
    return best;
  },[]);

  const isHexMode=soloMode==="hex"||mode==="multi"||(mode==="public"&&publicHex);
  const adj=(a,b)=>isHexMode?adjHex(a,b):(Math.abs(a.r-b.r)<=1&&Math.abs(a.c-b.c)<=1&&!(a.r===b.r&&a.c===b.c));
  const isSel=(r,c)=>sel.some(s=>s.r===r&&s.c===c);

  // Submit word (handles both solo and multiplayer)
  const submitWord=useCallback((currentSel,currentWord)=>{
    if(currentWord.length<3)return;

    // Public game (Piilosauna)
    if(mode==="public"&&socket){
      if(!WORDS_SET.has(currentWord)&&currentWord.length<=10){
        setMsg({t:currentWord,ok:false,m:T[lang]?.notValid||"Ei kelpaa"});setShake(true);setTimeout(()=>setShake(false),400);sounds.playWrong();
        return;
      }
      if(found.includes(currentWord)){
        setMsg({t:currentWord,ok:false,m:"Jo löydetty!"});setShake(true);setTimeout(()=>setShake(false),400);sounds.playWrong();
        return;
      }
      lastSubmittedWordRef.current=currentWord;
      socket.emit("public_word_found",{word:currentWord});
      return;
    }

    if(mode==="multi"&&socket){
      // Client-side dictionary check before sending to server (skip for long words - server validates)
      if(!WORDS_SET.has(currentWord)&&currentWord.length<=10){
        setMsg({t:currentWord,ok:false,m:T[lang]?.notValid||"Ei kelpaa"});setShake(true);setTimeout(()=>setShake(false),400);sounds.playWrong();
        return;
      }
      lastSubmittedWordRef.current=currentWord;
      if(gameMode==="battle"){
        const cells=currentSel.map(s=>({r:s.r,c:s.c}));
        socket.emit("battle_word_found",{word:currentWord,cells});
      }else{
        socket.emit("word_found",{word:currentWord});
      }
      return;
    }
    
    // Solo mode logic
    const now=Date.now();
    // Always validate against valid set (pre-computed words traceable on current grid)
    // In tetris mode, valid is recomputed after each gravity step
    let isValidWord=valid.has(currentWord);
    const alreadyFound=found.includes(currentWord);

    // For long words (>8 chars), validate server-side if not in local set
    if(!isValidWord&&currentWord.length>8&&lang==="fi"){
      const savedSel=[...currentSel];
      fetch(`${SERVER_URL}/api/validate-word`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({word:currentWord})})
        .then(r=>r.json()).then(({valid:v})=>{
          if(v&&!found.includes(currentWord)){
            // Score the word directly
            const n2=Date.now();
            let p2=letterMult?ptsLetters(currentWord,lang):pts(currentWord.length);
            const isC=(n2-lastFoundTime)<COMBO_WINDOW&&lastFoundTime>0;
            const nc=isC?combo+1:1;
            setCombo(nc);setLastFoundTime(n2);
            const cm=nc>=5?3:nc>=3?2:1;
            const tp=p2*cm;
            setScore(s=>s+tp);setFound(f=>[...f,currentWord]);
            setValid(prev=>{const n=new Set(prev);n.add(currentWord);return n;});
            setMsg({t:currentWord,ok:true,p:tp,combo:nc});
            setFlashKey(k=>k+1);
            sounds.playByLength(currentWord.length);
            if(nc>=3)setTimeout(()=>sounds.playCombo(nc),200);
            // Popup
            let popX,popY;
            if(gRef.current&&savedSel.length>0){
              const mid=savedSel[Math.floor(savedSel.length/2)];
              const cellEl=gRef.current.querySelector(`[data-c="${mid.r},${mid.c}"]`);
              if(cellEl){const cr=cellEl.getBoundingClientRect();popX=cr.left+cr.width/2;popY=cr.top+cr.height/2;}
              else{const rect=gRef.current.getBoundingClientRect();popX=rect.left+rect.width/2;popY=rect.top+rect.height/2;}
            }else if(gRef.current){const rect=gRef.current.getBoundingClientRect();popX=rect.left+rect.width/2;popY=rect.top+rect.height/2;}
            if(popX)addPopup(`${currentWord.toUpperCase()} +${tp}${nc>=3?` x${cm}`:""}`,wordColor(),popX,popY);
          }else if(v){
            setMsg({t:currentWord,ok:false,m:"Jo löydetty!"});setShake(true);setTimeout(()=>setShake(false),400);sounds.playWrong();
          }else{
            setMsg({t:currentWord,ok:false,m:T[lang]?.notValid||"Ei kelpaa"});setShake(true);setTimeout(()=>setShake(false),400);sounds.playWrong();
          }
        }).catch(()=>{
          setMsg({t:currentWord,ok:false,m:T[lang]?.notValid||"Ei kelpaa"});setShake(true);setTimeout(()=>setShake(false),400);sounds.playWrong();
        });
      return;
    }

    // In tetris mode, allow re-finding same word (grid changed, new path)
    if(isValidWord&&(soloMode==="tetris"?true:!alreadyFound)){
      let p=letterMult?ptsLetters(currentWord,lang):pts(currentWord.length);
      const isCombo=(now-lastFoundTime)<COMBO_WINDOW&&lastFoundTime>0;
      const newCombo=isCombo?combo+1:1;
      setCombo(newCombo);setLastFoundTime(now);
      const comboMult=newCombo>=5?3:newCombo>=3?2:1;
      const totalPts=p*comboMult;
      setScore(s=>s+totalPts);setFound(f=>[...f,currentWord]);
      setMsg({t:currentWord,ok:true,p:totalPts,combo:newCombo});
      setFlashKey(k=>k+1);
      sounds.playByLength(currentWord.length);
      if(newCombo>=3)setTimeout(()=>sounds.playCombo(newCombo),200);
      {
        // Position popup at the center of selected cells on the grid
        let popX,popY;
        if(gRef.current&&currentSel.length>0){
          const mid=currentSel[Math.floor(currentSel.length/2)];
          const cellEl=gRef.current.querySelector(`[data-c="${mid.r},${mid.c}"]`);
          if(cellEl){const cr=cellEl.getBoundingClientRect();popX=cr.left+cr.width/2;popY=cr.top+cr.height/2;}
          else{const rect=gRef.current.getBoundingClientRect();popX=rect.left+rect.width/2;popY=rect.top+rect.height/2;}
        }else{const rect=(gRef.current||wordBarRef.current).getBoundingClientRect();popX=rect.left+rect.width/2;popY=rect.top+rect.height/2;}
        const color=wordColor();
        let text=`+${totalPts}`;
        if(newCombo>=3)text+=` x${comboMult}`;
        addPopup(`${currentWord.toUpperCase()} ${text}`,color,popX,popY);
      }
      // Tetris mode: remove used cells, apply gravity, recompute valid words
      if(soloMode==="tetris"){
        const cells=currentSel.map(s=>({r:s.r,c:s.c}));
        const newGrid=applyGravityClient(grid,cells,lang);
        setGrid(newGrid);
        setDropKey(k=>k+1);
        const newValid=(soloMode==="hex"?findWordsHex:findWords)(newGrid,trie);
        setValid(newValid);
      }
      // Theme mode: check if word is a theme word
      if(soloMode==="theme"&&activeTheme){
        if(activeTheme.words.includes(currentWord)&&!themeFound.includes(currentWord)){
          const bonus=5;
          setScore(s=>s+bonus);
          setThemeFound(f=>[...f,currentWord]);
          addPopup(`${t.themeBonus} +${bonus}`,`#44bb66`);
        }
      }
      // Daily mode: check if word is a theme word, give bonus at threshold
      if(dailyMode&&dailyTheme){
        const stem=isThemeWord(currentWord,dailyTheme);
        if(stem&&!dailyThemeFound.includes(stem)){
          const newFound=[...dailyThemeFound,stem];
          setDailyThemeFound(newFound);
          // Show per-word notification
          const themeLabel=lang==="en"?"Theme word!":lang==="sv"?"Temaord!":"Teemasana!";
          addPopup(`🎯 ${themeLabel}`,S.yellow||"#ffcc00");
          // Give bonus when reaching threshold
          if(newFound.length===DAILY_THEME_THRESHOLD&&!dailyThemeBonusGiven){
            setDailyThemeBonusGiven(true);
            setScore(s=>s+DAILY_THEME_BONUS);
            setTimeout(()=>{
              const bonusLabel=lang==="en"?"Theme bonus":lang==="sv"?"Temabonus":"Teemabonus";
              addPopup(`🌟 ${bonusLabel} +${DAILY_THEME_BONUS}!`,S.yellow||"#ffcc00");
            },600);
          }
        }
      }
      // Bomb mode: check if word uses bomb cell
      if(soloMode==="bomb"&&bombCell){
        const usesBomb=currentSel.some(s=>s.r===bombCell.r&&s.c===bombCell.c);
        if(usesBomb){
          // Defused! Pick new bomb
          const bonus=3;
          setScore(s=>s+bonus);
          addPopup(`💣 +${bonus}`,"#ff4444");
          setBombCell(pickBombCell(SZ));setBombTimer(15);
        }
      }
      // Mystery mode: check if word passes through mystery cell
      if(soloMode==="mystery"&&mysteryCell&&!mysteryRevealed){
        const usesMystery=currentSel.some(s=>s.r===mysteryCell.r&&s.c===mysteryCell.c);
        if(usesMystery){
          setMysteryRevealed(true);
          const bonus=3;
          setScore(s=>s+bonus);
          addPopup(`${t.mysteryRevealed} +${bonus}`,"#aa66ff");
          // After a delay, pick new mystery cell
          setTimeout(()=>{setMysteryCell(pickMysteryCell(SZ));setMysteryRevealed(false);},2000);
        }
      }
    }else if(found.includes(currentWord)){
      setMsg({t:currentWord,ok:false,m:"Jo löydetty!"});setShake(true);setTimeout(()=>setShake(false),400);sounds.playWrong();
    }else{
      setMsg({t:currentWord,ok:false,m:T[lang]?.notValid||"Ei kelpaa"});setShake(true);setTimeout(()=>setShake(false),400);sounds.playWrong();
    }
  },[valid,found,lastFoundTime,combo,sounds,addPopup,mode,socket,gameMode,soloMode,grid,trie,letterMult,activeTheme,themeFound,bombCell,mysteryCell,mysteryRevealed,lang,dailyMode,dailyTheme,dailyThemeFound,dailyThemeBonusGiven]);

  // Active grid: use currentMultiGrid in multi mode, grid in solo
  const activeGrid=mode==="multi"?currentMultiGrid:grid;

  // Drag handlers
  const onDragStart=useCallback((r,c)=>{if(state!=="play"||rotateActive)return;if(soloMode==="chess"){chessClickCell(r,c);return;}setDragging(true);const s=[{r,c}];setSel(s);selRef.current=s;setWord(activeGrid[r]?.[c]||"");setMsg(null);
    // Battle mode: broadcast selection start
    if(mode==="multi"&&gameMode==="battle"&&socket)socket.emit("battle_selection",{cells:[{r,c}]});
  },[state,activeGrid,mode,gameMode,socket,soloMode,chessClickCell]);
  const selRef=useRef([]);
  const onDragMove=useCallback((x,y)=>{
    if(!dragging||state!=="play")return;
    const last=selRef.current.length>0?selRef.current[selRef.current.length-1]:null;
    const cell=cellAt(x,y,last);if(!cell)return;
    setSel(prev=>{
      let next=prev;
      if(prev.length>0&&prev[prev.length-1].r===cell.r&&prev[prev.length-1].c===cell.c)return prev;
      if(prev.length>=2&&prev[prev.length-2].r===cell.r&&prev[prev.length-2].c===cell.c){next=prev.slice(0,-1);setWord(next.map(s=>activeGrid[s.r][s.c]).join(""));}
      else if(prev.some(p=>p.r===cell.r&&p.c===cell.c))return prev;
      else if(prev.length>0&&!adj(prev[prev.length-1],cell))return prev;
      else{next=[...prev,cell];setWord(next.map(s=>activeGrid[s.r][s.c]).join(""));}
      // Battle mode: broadcast selection
      if(mode==="multi"&&gameMode==="battle"&&socket)socket.emit("battle_selection",{cells:next.map(s=>({r:s.r,c:s.c}))});
      selRef.current=next;
      return next;
    });
  },[dragging,state,cellAt,activeGrid,mode,gameMode,socket]);
  const onDragEnd=useCallback(()=>{if(!dragging)return;setDragging(false);submitWord(sel,word);setSel([]);selRef.current=[];setWord("");
    // Battle mode: clear selection broadcast
    if(mode==="multi"&&gameMode==="battle"&&socket)socket.emit("battle_selection",{cells:[]});
  },[dragging,sel,word,submitWord,mode,gameMode,socket]);

  const fmt=s=>`${Math.floor(s/60)}:${(s%60).toString().padStart(2,"0")}`;

  // Grid flash animation via ref (no key remount)
  useEffect(()=>{
    if(flashKey<=0||!gRef.current)return;
    const el=gRef.current;
    el.style.animation="none";
    void el.offsetHeight; // force reflow
    el.style.animation="gridFlash 0.5s ease-out";
    if(combo>=3)el.style.animation="comboGlow 1s infinite";
  },[flashKey]);
  useEffect(()=>{
    if(!gRef.current)return;
    gRef.current.style.animation=combo>=3&&state==="play"?"comboGlow 1s infinite":"none";
  },[combo,state]);

  // Socket.io connection setup for multiplayer
  useEffect(()=>{
    if(mode!=="multi"&&mode!=="public")return;
    
    const newSocket=io(SERVER_URL,{reconnection:true,reconnectionDelay:1000,reconnectionDelayMax:5000,reconnectionAttempts:5});
    
    newSocket.on("connect",()=>{
      console.log("Connected to server");
      setSocketConnected(true);
      // Auto-join public arena if logged in (skipped nickname screen)
      if(mode==="public"){
        const auth=(() => {try{return JSON.parse(localStorage.getItem("piilosana_auth")||"null")}catch{return null}})();
        if(auth?.nickname){
          newSocket.emit("join_public",{nickname:auth.nickname,lang});
        }
      }
      // Auto-join room from deep link (?room=XXXX)
      if(mode==="multi"&&roomCode){
        const auth=(() => {try{return JSON.parse(localStorage.getItem("piilosana_auth")||"null")}catch{return null}})();
        if(auth?.nickname){
          setLobbyState("joining");
          newSocket.emit("join_room",{roomCode,nickname:auth.nickname,mode:"multi"});
        }
      }
    });

    newSocket.on("disconnect",()=>{
      setSocketConnected(false);
      setLobbyState(prev=>{
        if(prev==="creating"||prev==="joining"){
          setLobbyError("Yhteys palvelimeen katkesi. Yritä uudelleen.");
          return "choose";
        }
        return prev;
      });
      // Jos pelin aikana yhteys katkeaa, ilmoita ja palaa valikkoon – pelitila
      // ei voi enää jatkua koska palvelin ei tunne meitä uudessa yhteydessä.
      const inPublicGame=mode==="public"&&(publicState==="playing"||publicState==="countdown");
      const inMultiGame=mode==="multi"&&(state==="play"||state==="countdown"||state==="ending");
      if(inPublicGame||inMultiGame){
        setTimeout(()=>{
          alert(lang==="en"?"Connection lost. Returning to menu.":lang==="sv"?"Anslutningen bröts. Återgår till menyn.":"Yhteys katkesi. Palataan valikkoon.");
          returnToModeSelect();
        },100);
      }
    });

    // Server lähettää tämän kun se on lähdössä alas (uuden version deploy).
    // Annetaan käyttäjälle selvä palaute, ei hiljaista bug-kokemusta.
    newSocket.on("server_draining",()=>{
      console.log("Server draining — version update");
      const inGame=(mode==="public"&&publicState==="playing")||(mode==="multi"&&state==="play");
      if(inGame){
        setTimeout(()=>{
          alert(lang==="en"?"Server is updating. The game will end – please try again in a moment.":lang==="sv"?"Servern uppdateras. Spelet avslutas – försök igen om en stund.":"Päivitys käynnissä – peli päättyy. Yritä hetken päästä uudelleen.");
          returnToModeSelect();
        },100);
      }
    });

    newSocket.on("connect_error",(err)=>{
      console.log("Connection error:",err.message);
      setSocketConnected(false);
    });
    
    newSocket.on("room_list",({rooms:roomList})=>{
      setPublicRooms(roomList||[]);
    });

    newSocket.on("room_created",({roomCode:code,playerId:pid})=>{
      setRoomCode(code);
      setPlayerId(pid);
      setIsHost(true);
      setLobbyState("waiting");
    });

    newSocket.on("room_joined",({roomCode:code,playerId:pid})=>{
      setRoomCode(code);
      setPlayerId(pid);
      setIsHost(false);
      setLobbyState("waiting");
    });

    newSocket.on("room_update",({players:playerList})=>{
      setPlayers(playerList);
      // Check if we became host (host transfer on disconnect)
      const me=playerList.find(p=>p.playerId===newSocket.id);
      if(me&&me.isHost)setIsHost(true);
    });
    
    newSocket.on("game_started",({grid:g,validWords:vw,gameMode:gm})=>{
      setCurrentMultiGrid(g);
      setValid(new Set(vw));
      setFound([]);
      setWord("");
      setTime(gameTime);
      setScore(0);
      setMsg(null);
      setCombo(0);
      setLastFoundTime(0);
      setPopups([]);setWordPopups([]);
      setMultiScores([]);
      setEatenCells(new Set());
      setEnding(null);
      setEndingProgress(0);
      setGameMode(gm||"classic");
      setOtherSelections({});
      setBattleMsg(null);
      setEmojiFeed([]);
      setLobbyState("playing");
      startTimeRef.current=Date.now();
      // Scramble intro
      {const styles=["random","wave","rain","spiral","scatter"];setScrambleStyle(styles[Math.floor(Math.random()*styles.length)]);}
      setSettledCells(new Set());setScrambleStep(0);
      const isHex=g&&g.length===HEX_ROWS&&g[0]?.length===HEX_COLS;
      setScrambleGrid(isHex?makeGrid(HEX_ROWS,lang,HEX_COLS):makeGrid(SZ,lang));
      setState("scramble");
    });
    
    newSocket.on("timer_tick",({remaining})=>{
      setTime(remaining);
      if(remaining<=15&&remaining>0)sounds.playTick(remaining);
    });
    
    newSocket.on("score_update",({scores})=>{
      setMultiScores(scores);
    });
    
    newSocket.on("word_result",({valid:isValid,message,points,combo:c})=>{
      if(isValid){
        const w=lastSubmittedWordRef.current;
        if(w&&!foundRef.current.includes(w)){
          setScore(s=>s+points);
          setFound(f=>[...f,w]);
          setCombo(c);
          setLastFoundTime(Date.now());
          setFlashKey(k=>k+1);
          sounds.playByLength(w.length);
          if(c>=3)setTimeout(()=>sounds.playCombo(c),200);
          setMsg({t:w,ok:true,p:points,combo:c});
          {
            const rect=(gRef.current||wordBarRef.current).getBoundingClientRect();
            const popX=rect.left+rect.width/2,popY=rect.top+rect.height/2;
            const tid=themeIdRef.current;
            const color=(THEMES[tid]||THEMES.dark).green;
            let text=`+${points}`;
            if(c>=3)text+=` x${Math.floor(points/(pts(w.length)))}`;
            addPopup(`${w.toUpperCase()} ${text}`,color,popX,popY);
          }
        }
      }else{
        setMsg({t:lastSubmittedWordRef.current||"",ok:false,m:message||"Ei kelpaa"});
        setShake(true);
        setTimeout(()=>setShake(false),400);
        sounds.playWrong();
      }
      setSel([]);
      setWord("");
    });
    
    // Battle mode: grid update (someone found a word, grid changed)
    newSocket.on("battle_grid_update",({grid:newGrid,removedCells,word:foundWord,finder,finderId,points:p})=>{
      setBattleMsg({word:foundWord,finder,finderId,points:p});
      setTimeout(()=>setBattleMsg(null),2000);
      setCurrentMultiGrid(newGrid);
      setDropKey(k=>k+1);
      // Clear other player's selection since grid changed
      setOtherSelections({});
    });

    // Battle mode: other players' selections
    newSocket.on("battle_player_selection",({playerId:pid,nickname:nick,cells})=>{
      setOtherSelections(prev=>({...prev,[pid]:{nickname:nick,cells}}));
    });

    newSocket.on("game_over",({rankings,validWords:vw,allFoundWords:afw})=>{
      setMultiRankings(rankings);
      if(vw)setMultiValidWords(vw);
      if(afw)setMultiAllFoundWords(afw);
      // Start ending animation (random per player)
      const e=ENDINGS[Math.floor(Math.random()*ENDINGS.length)];
      setEnding(e);
      sounds.playEnding();
      setState("ending");
    });
    
    newSocket.on("error",({message})=>{
      setLobbyError(message);
      setLobbyState("choose");
    });
    
    newSocket.on("room_not_found",()=>{
      setLobbyError("Huonetta ei löydy!");
      setTimeout(()=>setLobbyError(""),3000);
    });

    // ---- PUBLIC GAME (PIILOSAUNA) events ----
    newSocket.on("public_countdown",({grid:g,validWords:vw,roundNumber,hex})=>{
      setGrid(g);setValid(new Set(vw));setFound([]);setSel([]);setWord("");setScore(0);setMsg(null);
      setEatenCells(new Set());setCombo(0);setLastFoundTime(0);setPopups([]);setWordPopups([]);setEnding(null);setDropKey(0);
      setTime(120);setPublicState("playing");setPublicCountdown(0);setPublicRound(roundNumber);
      setPublicRankings(null);setPublicHex(!!hex);startTimeRef.current=Date.now();
      // Scramble intro
      {const styles=["random","wave","rain","spiral","scatter"];setScrambleStyle(styles[Math.floor(Math.random()*styles.length)]);}
      setSettledCells(new Set());setScrambleStep(0);setScrambleGrid(makeGrid(HEX_ROWS,lang,HEX_COLS));setState("scramble");
    });
    newSocket.on("public_join_midgame",({grid:g,validWords:vw,timeLeft:tl,roundNumber,hex})=>{
      setGrid(g);setValid(new Set(vw));setFound([]);setSel([]);setWord("");setScore(0);setMsg(null);
      setEatenCells(new Set());setCombo(0);setLastFoundTime(0);setPopups([]);setWordPopups([]);setEnding(null);setDropKey(0);
      setTime(tl);setPublicState("playing");setPublicRound(roundNumber);setPublicRankings(null);setState("play");setPublicHex(!!hex);
      startTimeRef.current=Date.now();
    });
    newSocket.on("public_game_start",()=>{
      setPublicState("playing");setState("play");startTimeRef.current=Date.now();
    });
    newSocket.on("public_timer_tick",({remaining})=>{
      setTime(remaining);
      if(remaining<=15&&remaining>0)soundsRef.current.playTick(remaining);
    });
    newSocket.on("public_score_update",({scores})=>{
      setPublicScores(scores);
    });
    newSocket.on("public_word_result",({valid:isValid,message,points})=>{
      if(isValid){
        const w=lastSubmittedWordRef.current;
        setFound(prev=>[...prev,w]);
        const p=points||pts(w.length);
        setScore(prev=>prev+p);
        const color=(THEMES[themeIdRef.current]||THEMES.dark).green;
        addPopup(`${w.toUpperCase()} +${p}`,color);
        soundsRef.current.playByLength(w.length);
      }else{
        setMsg({t:lastSubmittedWordRef.current,ok:false,m:message});
        setShake(true);setTimeout(()=>setShake(false),400);
        soundsRef.current.playWrong();
      }
    });
    newSocket.on("public_game_over",({rankings,validWords:vw,allFoundWords:afw})=>{
      setPublicRankings(rankings);
      setValid(new Set(vw));
      setPublicAllFound(afw||[]);
      const e=ENDINGS[Math.floor(Math.random()*ENDINGS.length)];
      setEnding(e);soundsRef.current.playEnding();
      setState("ending");
    });
    newSocket.on("public_player_count",({count})=>{
      setPublicPlayerCount(count);
    });
    newSocket.on("public_waiting",({playerCount:c,nextRoundCountdown:nrc})=>{
      setPublicState("waiting");setPublicPlayerCount(c);
      if(nrc)setPublicNextCountdown(nrc);
    });
    newSocket.on("public_next_round_countdown",({seconds})=>{
      setPublicNextCountdown(seconds);
    });
    newSocket.on("emoji_feed",({nickname,emoji})=>{
      if(muteEmojisRef.current)return;
      const id=++emojiFeedIdRef.current;
      setEmojiFeed(prev=>[...prev.slice(-7),{id,nickname,emoji,fading:false}]);
      setTimeout(()=>setEmojiFeed(prev=>prev.map(e=>e.id===id?{...e,fading:true}:e)),3500);
      setTimeout(()=>setEmojiFeed(prev=>prev.filter(e=>e.id!==id)),4300);
    });

    setSocket(newSocket);
    
    return()=>{
      if(newSocket)newSocket.disconnect();
    };
  },[mode]);
  const missed=useMemo(()=>state==="end"?[...valid].filter(w=>!found.includes(w)).sort((a,b)=>b.length-a.length):[],[state,valid,found]);
  const totalPossible=useMemo(()=>[...valid].reduce((s,w)=>s+(letterMult?ptsLetters(w,lang):pts(w.length)),0),[valid,letterMult,lang]);
  const wordColor=()=>S.green;
  const[defPopup,setDefPopup]=useState(null); // {word,def,x,y}
  const DEFS=lang==="fi"?DEFS_FI:null;
  const showDef=useCallback((w,e)=>{
    if(!DEFS)return;
    const d=DEFS[w.toLowerCase()];
    if(!d)return;
    const r=e.currentTarget.getBoundingClientRect();
    setDefPopup({word:w,def:d,x:r.left+r.width/2,y:r.top});
  },[DEFS]);


  // Multiplayer helper functions
  const createRoom=useCallback(()=>{
    if(!socket||!nickname)return;
    if(!socket.connected){
      setLobbyError(lang==="en"?"No connection. Please wait...":"Ei yhteyttä palvelimeen. Odota hetki...");
      return;
    }
    setLobbyError("");
    setLobbyState("creating");
    socket.emit("create_room",{nickname,mode:"multi",lang});
    // Timeout: if no response in 10s, go back
    setTimeout(()=>{
      setLobbyState(prev=>{
        if(prev==="creating"){setLobbyError("Palvelin ei vastannut. Yritä uudelleen.");return "choose";}
        return prev;
      });
    },10000);
  },[socket,nickname]);

  const joinRoom=useCallback((code)=>{
    if(!socket||!code||!nickname)return;
    if(!socket.connected){
      setLobbyError(lang==="en"?"No connection. Please wait...":"Ei yhteyttä palvelimeen. Odota hetki...");
      return;
    }
    setLobbyError("");
    setLobbyState("joining");
    socket.emit("join_room",{roomCode:code,nickname,mode:"multi"});
    setTimeout(()=>{
      setLobbyState(prev=>{
        if(prev==="joining"){setLobbyError("Palvelin ei vastannut. Yritä uudelleen.");return "choose";}
        return prev;
      });
    },10000);
  },[socket,nickname]);
  
  // Unlimited mode: refresh grid with new letters
  const refreshGrid=useCallback(()=>{
    if(state!=="play"||gameTime!==0)return;
    let bg=null,bw=new Set();
    for(let i=0;i<50;i++){const g=soloMode==="hex"?makeGrid(HEX_ROWS,lang,HEX_COLS):makeGrid(SZ,lang);const w=(soloMode==="hex"?findWordsHex:findWords)(g,trie);if(w.size>bw.size){bg=g;bw=w;}if(w.size>=(soloMode==="hex"?25:15))break;}
    setGrid(bg);setValid(bw);setFound([]);setSel([]);setWord("");setMsg(null);
    setDropKey(0);
  },[state,gameTime,trie,lang,soloMode]);

  // Unlimited mode: end game voluntarily
  const endUnlimited=useCallback(()=>{
    if(gameTime!==0)return;
    const e=ENDINGS[Math.floor(Math.random()*ENDINGS.length)];
    setEnding(e);
    sounds.playEnding();
    setState("ending");
  },[gameTime,sounds]);

  const startGame=useCallback((selectedMode)=>{
    if(!socket||!isHost||players.length<2)return;
    const gm=selectedMode||gameMode;
    let bg=null,bw=new Set();
    for(let i=0;i<50;i++){const g=makeGrid(SZ,lang),w=(soloMode==="hex"?findWordsHex:findWords)(g,trie);if(w.size>bw.size){bg=g;bw=w;}if(w.size>=15)break;}
    setCurrentMultiGrid(bg);
    setGameMode(gm);
    socket.emit("start_game",{grid:bg,validWords:Array.from(bw),gameMode:gm,gameTime});
  },[socket,isHost,players,trie,gameMode,gameTime,lang]);
  
  const playAgain=useCallback(()=>{
    setLobbyState("waiting");
    setMultiRankings(null);
    setFound([]);
    setScore(0);
    setWord("");
    setState("menu");
  },[]);
  
  const returnToModeSelect=useCallback(()=>{
    if(socket){
      if(mode==="public")socket.emit("leave_public");
      socket.disconnect();
    }
    // Clean URL params
    if(window.location.search)window.history.replaceState({},"",window.location.pathname);
    setSocket(null);
    setMode(null);
    setPlayers([]);
    setRoomCode("");
    setNickname("");
    setPublicRooms([]);
    setPlayerId(null);
    setIsHost(false);
    setMultiScores([]);
    setMultiRankings(null);
    setLobbyState("enter_name");
    setLobbyError("");
    setSocketConnected(false);
    setGameMode("classic");
    setOtherSelections({});
    setBattleMsg(null);
    setPublicState(null);
    setPublicScores([]);
    setPublicRankings(null);
    setDailyMode(false);
    setDailyTheme(null);
    setDailyResult(getDailyResult(lang));
    setState("menu");
  },[socket,mode,lang]);
  
  const refreshRooms=useCallback(()=>{
    if(socket&&socket.connected)socket.emit("list_rooms");
  },[socket]);

  // Switch from solo to multi (or from multi results)
  const switchToMulti=useCallback(async()=>{
    if(socket)socket.disconnect();
    setSocket(null);
    sounds.init().catch(()=>{});
    setMode("multi");
    setPlayers([]);
    setRoomCode("");
    setPlayerId(null);
    setIsHost(false);
    setMultiScores([]);
    setMultiRankings(null);
    setLobbyState("enter_name");
    setLobbyError("");
    setSocketConnected(false);
    setPublicRooms([]);
    setState("menu");
  },[socket,sounds]);

  // Switch from multi to solo
  const switchToSolo=useCallback(()=>{
    if(socket)socket.disconnect();
    setSocket(null);
    setMode("solo");
    setPlayers([]);
    setRoomCode("");
    setPlayerId(null);
    setIsHost(false);
    setMultiScores([]);
    setMultiRankings(null);
    setLobbyState("enter_name");
    setLobbyError("");
    setSocketConnected(false);
    setPublicRooms([]);
    setState("menu");
  },[socket]);

  // Render multiplayer screens
  const S=theme;
  const Icon=S.cellGradient?ModernIcon:PixelIcon;
  const modeSelectJSX=(
    <div style={{textAlign:"center",marginTop:"16px",animation:"fadeIn 0.5s ease",maxWidth:"420px",width:"100%",position:"relative"}}>

      {/* Pikaohje – pieni pyöreä ?-nappi oikeassa yläkulmassa */}
      <button
        onClick={()=>setShowTutorial(true)}
        style={{
          position:"absolute",top:"-8px",right:"0",
          width:"36px",height:"36px",borderRadius:"50%",
          background:"rgba(255,255,255,0.12)",
          border:"1.5px solid rgba(255,255,255,0.25)",
          color:"rgba(255,255,255,0.7)",
          fontSize:"16px",fontWeight:"700",
          cursor:"pointer",
          display:"flex",alignItems:"center",justifyContent:"center",
          transition:"all 0.15s",
          zIndex:2,
        }}
        onMouseEnter={e=>{e.currentTarget.style.background="rgba(255,255,255,0.22)";e.currentTarget.style.color="#fff";}}
        onMouseLeave={e=>{e.currentTarget.style.background="rgba(255,255,255,0.12)";e.currentTarget.style.color="rgba(255,255,255,0.7)";}}
        aria-label={t.tutorialBtn}
      >?</button>

      {/* Tervetulo­banneri – näkyy vain ensikertalaisille */}
      <FirstTimeWelcome
        S={S}
        lang={lang}
        isFirstTime={achStats.gamesPlayed===0}
        onTryPractice={()=>setShowMenuOptions(true)}
      />

      {/* Streak-varoitus */}
      <StreakWarning
        S={S}
        lang={lang}
        streak={getDailyStreak(lang)}
        isPlayed={!!getDailyResult(lang)}
      />

      {/* ===== KOLME PELINAPPIA ===== */}
      <div style={{display:"flex",flexDirection:"column",gap:"10px"}}>

        {/* 1. ONLINE-PELI */}
        <button
          onClick={()=>{
            sounds.init().catch(()=>{});
            setMode("public");
            if(authUser){setPublicState("waiting");}else{setPublicState("nickname");}
          }}
          style={{
            fontFamily:S.font,width:"100%",
            padding:"18px 20px",
            background:menuColors.arenaBg,
            border:`2px solid ${menuColors.arenaBorder}`,
            borderRadius:"14px",
            color:menuColors.arenaText,
            cursor:"pointer",
            boxShadow:menuColors.softShadow,
            transition:"all 0.2s",
            textAlign:"left",
            position:"relative",
            overflow:"hidden",
          }}
          onMouseEnter={e=>{e.currentTarget.style.transform="translateY(-2px)";e.currentTarget.style.boxShadow="0 12px 30px rgba(0,0,0,0.35)";}}
          onMouseLeave={e=>{e.currentTarget.style.transform="none";e.currentTarget.style.boxShadow=menuColors.softShadow;}}
        >
          <div style={{position:"relative",zIndex:1}}>
            <div style={{fontSize:"20px",fontWeight:"900",letterSpacing:"1px",marginBottom:"2px"}}>
              {lang==="fi"?"ONLINE-PELI":lang==="sv"?"ONLINE-SPEL":"ONLINE GAME"}
            </div>
            <div style={{fontSize:"12px",fontWeight:"600",opacity:0.85}}>
              {lang==="fi"?"Pelaa muita vastaan · 2 min":lang==="sv"?"Spela mot andra · 2 min":"Play against others · 2 min"}
            </div>
            {publicOnlineCount>1&&(
              <span style={{position:"absolute",top:"2px",right:"0",fontSize:"11px",fontWeight:"700",background:"rgba(255,255,255,0.2)",borderRadius:"8px",padding:"3px 8px"}}>
                {publicOnlineCount} {lang==="fi"?"online":lang==="sv"?"online":"online"}
              </span>
            )}
          </div>
        </button>

        {/* 2. PÄIVÄN PIILOSANA */}
        {(()=>{
          const d=todayStr();
          const dl=dateLabel(d,lang);
          const res=getDailyResult(lang);
          const todayTheme=getDailyTheme(d,lang);
          const themeName=lang==="en"?(todayTheme.nameEn||todayTheme.name):lang==="sv"?(todayTheme.nameSv||todayTheme.name):todayTheme.name;
          const streak=getDailyStreak(lang);
          const isPlayed=res!=null;
          return(
            <button
              onClick={()=>{if(isPlayed){setShowDailyHistory(d);}else{startDaily();}}}
              style={{
                fontFamily:S.font,width:"100%",
                padding:"18px 20px",
                background:menuColors.dailyBg,
                border:`2px solid ${menuColors.dailyBorder}`,
                borderRadius:"14px",
                color:menuColors.dailyText,
                cursor:"pointer",
                boxShadow:menuColors.softShadow,
                transition:"all 0.2s",
                textAlign:"left",
              }}
              onMouseEnter={e=>{e.currentTarget.style.transform="translateY(-2px)";e.currentTarget.style.boxShadow="0 12px 30px rgba(0,0,0,0.35)";}}
              onMouseLeave={e=>{e.currentTarget.style.transform="none";e.currentTarget.style.boxShadow=menuColors.softShadow;}}
            >
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}>
                <div>
                  <div style={{fontSize:"20px",fontWeight:"900",letterSpacing:"1px",marginBottom:"2px"}}>
                    {t.daily}
                  </div>
                  <div style={{fontSize:"12px",fontWeight:"600",opacity:0.85}}>
                    {themeName} · 3 min
                  </div>
                </div>
                {isPlayed?(
                  <div style={{textAlign:"right"}}>
                    <div style={{fontSize:"28px",fontWeight:"800",color:menuColors.dailyAccent,lineHeight:1}}>{res.score}<span style={{fontSize:"14px",fontWeight:"400"}}>p</span></div>
                    {streak?.streak>1&&<div style={{fontSize:"11px",color:"#ff6644",fontWeight:"700"}}>🔥 {streak.streak}</div>}
                  </div>
                ):(
                  <div style={{fontSize:"12px",fontWeight:"700",color:menuColors.dailyAccent,background:"rgba(255,255,255,0.12)",borderRadius:"8px",padding:"6px 12px"}}>
                    {lang==="fi"?"PELAA":lang==="sv"?"SPELA":"PLAY"} ▶
                  </div>
                )}
              </div>
            </button>
          );
        })()}

        {/* 3. HARJOITTELU */}
        <button
          onClick={()=>setShowMenuOptions(true)}
          style={{
            fontFamily:S.font,width:"100%",
            padding:"18px 20px",
            background:menuColors.practiceBg,
            border:`2px solid rgba(255,255,255,0.15)`,
            borderRadius:"14px",
            color:menuColors.practiceText,
            cursor:"pointer",
            boxShadow:menuColors.softShadow,
            transition:"all 0.2s",
            textAlign:"left",
          }}
          onMouseEnter={e=>{e.currentTarget.style.transform="translateY(-2px)";e.currentTarget.style.boxShadow="0 12px 30px rgba(0,0,0,0.35)";}}
          onMouseLeave={e=>{e.currentTarget.style.transform="none";e.currentTarget.style.boxShadow=menuColors.softShadow;}}
        >
          <div style={{fontSize:"20px",fontWeight:"900",letterSpacing:"1px",marginBottom:"2px"}}>
            {t.practice}
          </div>
          <div style={{fontSize:"12px",fontWeight:"600",opacity:0.85}}>
            {lang==="fi"?"Pelaa yksin omaan tahtiin":lang==="sv"?"Spela ensam i egen takt":"Play solo at your own pace"}
          </div>
        </button>

      </div>

      {/* ===== AD SPACE ===== */}
      <div style={{width:"100%",minHeight:"90px",borderRadius:"14px",marginTop:"12px",marginBottom:"12px",border:`1px dashed rgba(255,255,255,0.15)`,display:"flex",alignItems:"center",justifyContent:"center",fontSize:"11px",color:"rgba(255,255,255,0.25)",fontFamily:S.font}}>
        {/* tila mainokselle */}
      </div>

      {/* Daily history popup with leaderboard */}
      {showDailyHistory&&(
        <DailyPopup dateStr={showDailyHistory} lang={lang} t={t} S={S}
          myResult={getDailyResultForDate(showDailyHistory,lang)||(showDailyHistory===todayStr()?getDailyResult(lang):null)}
          onShare={showDailyHistory===todayStr()?shareDailyResult:null}
          dailyShareMsg={dailyShareMsg}
          onClose={()=>setShowDailyHistory(null)} />
      )}

      {/* ===== Harjoittelun asetukset – overlay ===== */}
      {showMenuOptions&&(
        <PracticeOptionsModal
          S={S}
          t={t}
          lang={lang}
          Icon={Icon}
          gameTime={gameTime}
          letterMult={letterMult}
          onGameTimeChange={setGameTime}
          onLetterMultToggle={()=>setLetterMult(v=>!v)}
          onStart={()=>{startSolo();setShowMenuOptions(false);}}
          onClose={()=>setShowMenuOptions(false)}
        />
      )}

      {/* ===== Footer ===== */}
      <MenuFooter
        S={S}
        lang={lang}
        t={t}
        Icon={Icon}
        PixelFlag={PixelFlag}
        version={VERSION}
        langConfig={LANG_CONFIG}
        authUser={authUser}
        achUnlockedCount={Object.keys(achUnlocked).length}
        achTotalCount={Object.keys(ACHIEVEMENTS).length}
        wordCount={WORDS_SET.size}
        wordsLoaded={currentLangLoaded}
        onShowAchievements={()=>setShowAchievements(true)}
        onShowAuth={()=>{setShowAuth(true);setShowFirstTimeAuth(false);}}
        onShowInflection={()=>setShowInflection(true)}
        onShowHelp={()=>setShowHelp(true)}
        onShowWordInfo={()=>setShowWordInfo(true)}
        onLangChange={(code)=>{setLang(code);localStorage.setItem("piilosana_lang",code);setFlagBubble(false);sessionStorage.setItem("piilosana_flag_bubble_shown","1");syncSettings({lang:code});}}
      />
    </div>
  );
  
  const isWinner=multiRankings&&multiRankings.length>0&&multiRankings[0].playerId===playerId;
  const myRank=multiRankings?multiRankings.findIndex(p=>p.playerId===playerId):0;
  const ResultsScreen=()=>(
    <ResultsScreenView
      S={S}
      t={t}
      isWinner={isWinner}
      myRank={myRank}
      isHost={isHost}
      gameMode={gameMode}
      multiRankings={multiRankings}
      multiAllFoundWords={multiAllFoundWords}
      multiValidWords={multiValidWords}
      playerId={playerId}
      wordColor={wordColor}
      DEFS={DEFS}
      showDef={showDef}
      roomLang={room?.lang||"fi"}
      Icon={Icon}
      ConfettiCelebration={ConfettiCelebration}
      onPlayAgain={playAgain}
      onSwitchToSolo={switchToSolo}
      onReturnToMenu={returnToModeSelect}
    />
  );


  return(
    <div style={{fontFamily:S.font,background:S.bg,color:S.green,minHeight:"100dvh",display:"flex",flexDirection:"column",alignItems:"center",userSelect:"none",WebkitUserSelect:"none",padding:"8px 4px",position:"relative",overflowX:"hidden",animation:themeTransition?"themeResolve 0.6s ease-out":"none"}}
      onMouseMove={e=>onDragMove(e.clientX,e.clientY)} onMouseUp={onDragEnd} onTouchEnd={onDragEnd}>

      {/* Update available banner */}
      {updateAvailable&&<div style={{position:"fixed",top:0,left:0,right:0,zIndex:9999,background:"linear-gradient(135deg,#ffcc00,#ff9900)",color:"#1a1000",padding:"8px 16px",display:"flex",alignItems:"center",justifyContent:"center",gap:"12px",fontSize:"13px",fontFamily:S.font,fontWeight:"600",boxShadow:"0 2px 12px #00000044"}}>
        <span>{lang==="en"?"New version available!":lang==="sv"?"Ny version tillgänglig!":"Uusi versio saatavilla!"}</span>
        <button onClick={()=>window.location.reload()} style={{background:"#1a1000",color:"#ffcc00",border:"none",padding:"4px 14px",borderRadius:"6px",cursor:"pointer",fontFamily:S.font,fontWeight:"700",fontSize:"12px"}}>{lang==="en"?"UPDATE":lang==="sv"?"UPPDATERA":"PÄIVITÄ"}</button>
        <button onClick={()=>setUpdateAvailable(false)} style={{background:"transparent",border:"none",color:"#1a100088",cursor:"pointer",fontSize:"18px",lineHeight:"1",padding:"0 4px"}}>×</button>
      </div>}

      {/* Global hamburger — top-left, always visible */}
      {state!=="play"&&state!=="ending"&&state!=="scramble"&&(
        <button onClick={()=>setShowHamburger(true)} style={{position:"fixed",left:"10px",top:"14px",zIndex:100,background:`${S.dark}cc`,border:`1px solid ${S.border}`,padding:"6px 10px",cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center",borderRadius:"10px",transition:"all 0.15s",fontSize:"20px",color:S.textMuted,lineHeight:"1",height:"36px",backdropFilter:"blur(8px)",WebkitBackdropFilter:"blur(8px)"}}
          onMouseEnter={e=>{e.currentTarget.style.borderColor=S.green;e.currentTarget.style.color=S.green;e.currentTarget.style.background=S.green+"15";}}
          onMouseLeave={e=>{e.currentTarget.style.borderColor=S.border;e.currentTarget.style.color=S.textMuted;e.currentTarget.style.background=`${S.dark}cc`;}}>
          &#9776;
        </button>
      )}

      {/* Word definition popup */}
      {defPopup&&(
        <div style={{position:"fixed",top:0,left:0,width:"100%",height:"100%",zIndex:300}} onClick={()=>setDefPopup(null)}>
          <div style={{position:"fixed",left:"50%",top:"40%",
            transform:"translate(-50%,-50%)",background:S.dark||"#1a1a2e",border:`2px solid ${S.green}`,
            padding:"10px 16px",borderRadius:"12px",boxShadow:`0 4px 20px #00000066`,
            maxWidth:"280px",width:"auto",zIndex:301,animation:"pop 0.2s ease"}} onClick={e=>e.stopPropagation()}>
            <div style={{fontSize:"16px",fontWeight:"700",color:S.yellow,marginBottom:"4px"}}>{defPopup.word.toUpperCase()}</div>
            <div style={{fontSize:"13px",color:S.green,lineHeight:"1.5"}}>{defPopup.def}</div>
          </div>
        </div>
      )}
      {/* Top bar removed — buttons moved to footer */}
      {/* Word info modal */}
      {showWordInfo&&(
        <WordInfoModal S={S} t={t} langConfig={LANG_CONFIG} onClose={()=>setShowWordInfo(false)} />
      )}
      {/* Help / How to play modal */}
      {showTutorial&&<QuickTutorial lang={lang} theme={S} onClose={()=>setShowTutorial(false)}/>}
      {showHelp&&(
        <HelpModal S={S} t={t} onClose={()=>setShowHelp(false)} />
      )}

      {/* Inflection table modal */}
      {showInflection&&(
        <InflectionModal S={S} lang={lang} onClose={()=>setShowInflection(false)} />
      )}

      {/* Share popup — game link + QR */}
      {showSharePopup&&(()=>{
        const shareUrl=mode==="public"?`${window.location.origin}?arena`:`${window.location.origin}?room=${roomCode}`;
        const copyLink=()=>{navigator.clipboard.writeText(shareUrl).then(()=>{setLinkCopied(true);setTimeout(()=>setLinkCopied(false),2000);}).catch(()=>{});};
        return(
        <div onClick={()=>setShowSharePopup(false)} style={{position:"fixed",top:0,left:0,right:0,bottom:0,background:"#000000cc",zIndex:300,display:"flex",alignItems:"center",justifyContent:"center",padding:"20px",animation:"fadeIn 0.3s ease"}}>
          <div onClick={e=>e.stopPropagation()} style={{background:S.bg,border:`3px solid ${S.green}`,padding:"24px",maxWidth:"360px",width:"100%",textAlign:"center"}}>
            <div style={{fontSize:"14px",color:S.green,marginBottom:"16px",fontWeight:"bold"}}>{t.shareGame}</div>
            <div style={{display:"flex",gap:"6px",alignItems:"center",justifyContent:"center",marginBottom:"16px"}}>
              <input readOnly value={shareUrl} style={{fontFamily:S.font,fontSize:"12px",color:S.textSoft,background:S.dark,border:`1px solid ${S.border}`,padding:"8px",flex:1,outline:"none",textAlign:"center"}} onClick={e=>e.target.select()}/>
              <button onClick={copyLink} style={{fontFamily:S.font,fontSize:"12px",color:linkCopied?S.bg:S.green,background:linkCopied?S.green:"transparent",border:`2px solid ${S.green}`,padding:"8px 14px",cursor:"pointer",minWidth:"90px",transition:"all 0.2s"}}>{linkCopied?t.copied:t.shareLink}</button>
            </div>
            <div style={{display:"flex",flexDirection:"column",alignItems:"center",gap:"8px",marginBottom:"16px"}}>
              <QRCodeSVG value={shareUrl} size={140} bgColor="transparent" fgColor={S.textSoft} level="L"/>
              <p style={{fontSize:"12px",color:S.textMuted}}>{t.scanToJoin}</p>
            </div>
            <button onClick={()=>setShowSharePopup(false)} style={{fontFamily:S.font,fontSize:"13px",color:S.green,border:`2px solid ${S.green}`,background:"transparent",padding:"8px 24px",cursor:"pointer"}}>{t.exitNo||"SULJE"}</button>
          </div>
        </div>);
      })()}
      <style>{fontCSS}</style>
      <style>{`
        @keyframes shake{0%,100%{transform:translateX(0)}20%{transform:translateX(-4px)}40%{transform:translateX(4px)}60%{transform:translateX(-3px)}80%{transform:translateX(3px)}}
        @keyframes pop{0%{transform:scale(1)}50%{transform:scale(1.3)}100%{transform:scale(1)}}
        @keyframes chessArrive{0%{transform:translate(var(--chess-dx),var(--chess-dy)) scale(1.2);opacity:0.6}60%{transform:translate(0,0) scale(1.1);opacity:1}100%{transform:translate(0,0) scale(1);opacity:1}}
        @keyframes snowfall{0%{transform:translateY(0);opacity:0.6}100%{transform:translateY(30px);opacity:0}}
        @keyframes fadeIn{0%{opacity:0;transform:translateY(20px)}100%{opacity:1;transform:translateY(0)}}
        @keyframes spin{0%{transform:rotate(0deg)}100%{transform:rotate(360deg)}}
        @keyframes slideInLeft{0%{transform:translateX(-100%);opacity:0}100%{transform:translateX(0);opacity:1}}
        @keyframes bubbleIn{0%{opacity:0;transform:scale(0.3) translateY(10px)}40%{opacity:1;transform:scale(1.08) translateY(-2px)}100%{opacity:1;transform:scale(1) translateY(0)}}
        @keyframes bubbleOut{0%{opacity:1;transform:scale(1)}100%{opacity:0;transform:scale(0.6) translateY(-10px)}}
        @keyframes chatSlideIn{0%{opacity:0;transform:translateX(-30px) scale(0.7)}30%{opacity:1;transform:translateX(4px) scale(1.04)}60%{transform:translateX(-2px) scale(0.98)}100%{opacity:1;transform:translateX(0) scale(1)}}
        @keyframes chatFadeOut{0%{opacity:1;transform:scale(1)}100%{opacity:0;transform:scale(0.92);max-height:0;margin:0;padding:0}}
        @keyframes pulse{0%,100%{text-shadow:0 0 5px #ff444444}50%{text-shadow:0 0 20px #ff444488}}
        @keyframes arenaPulse{0%,100%{box-shadow:4px 4px 0 #d4888b,0 0 20px #e5989b33}50%{box-shadow:4px 4px 0 #d4888b,0 0 35px #e5989b55}}
        @keyframes floatUp{0%{opacity:1;transform:translate(-50%,-50%) scale(1.2)}50%{opacity:1;transform:translate(-50%,-100%) scale(1.5)}100%{opacity:0;transform:translate(-50%,-180%) scale(1.8)}}
        @keyframes wordRise{0%{opacity:0.9;transform:translate(-50%,-50%) scale(0.8)}20%{opacity:1;transform:translate(-50%,-80%) scale(1.1)}60%{opacity:0.8;transform:translate(-50%,-140%) scale(1)}100%{opacity:0;transform:translate(-50%,-200%) scale(0.9)}}
        @keyframes wordRiseBig{0%{opacity:0.9;transform:translate(-50%,-50%) scale(0.6)}15%{opacity:1;transform:translate(-50%,-70%) scale(1.3)}30%{transform:translate(-50%,-90%) scale(1.15)}60%{opacity:0.8;transform:translate(-50%,-150%) scale(1.05)}100%{opacity:0;transform:translate(-50%,-220%) scale(0.95)}}
        @keyframes wordRiseEpic{0%{opacity:0.9;transform:translate(-50%,-50%) scale(0.4)}10%{opacity:1;transform:translate(-50%,-60%) scale(1.5)}25%{transform:translate(-50%,-80%) scale(1.2)}40%{transform:translate(-50%,-100%) scale(1.3)}60%{opacity:0.9;transform:translate(-50%,-140%) scale(1.1)}100%{opacity:0;transform:translate(-50%,-240%) scale(1)}}
        @keyframes comboGlow{0%,100%{box-shadow:0 0 5px #ffcc0044}50%{box-shadow:0 0 25px #ffcc0088,0 0 50px #ff66ff44}}
        @keyframes epicPulse{0%{transform:scale(1)}50%{transform:scale(1.05)}100%{transform:scale(1)}}
        @keyframes wordFlash{0%{background:#00ff8833;box-shadow:0 0 20px #00ff8866}100%{background:transparent;box-shadow:none}}
        @keyframes gridFlash{0%{border-color:#00ff88;box-shadow:0 0 30px #00ff8866}100%{border-color:#334;box-shadow:0 0 30px #00ff8822}}
        @keyframes scoreJump{0%{transform:scale(1)}30%{transform:scale(1.4)}100%{transform:scale(1)}}
        @keyframes cellShrinkSpin{0%{transform:scale(1) rotate(0);opacity:1}100%{transform:scale(0) rotate(180deg);opacity:0}}
        @keyframes cellFloat{0%{transform:translateY(0);opacity:1}40%{transform:translateY(-10px);opacity:0.8}100%{transform:translateY(60px);opacity:0}}
        @keyframes cellExplode{0%{transform:scale(1) translate(0,0);opacity:1}100%{transform:scale(0.3) translate(var(--ex,0px),var(--ey,0px));opacity:0}}
        @keyframes cellBurn{0%{opacity:1;filter:brightness(1)}40%{filter:brightness(2) saturate(2)}100%{opacity:0;filter:brightness(0.2);transform:scale(0.8)}}
        @keyframes cellVortex{0%{transform:scale(1) rotate(0) translate(0,0);opacity:1}100%{transform:scale(0) rotate(720deg) translate(0,0);opacity:0}}
        @keyframes cellBeamUp{0%{transform:translateY(0) scaleY(1);opacity:1}50%{transform:translateY(-10px) scaleY(1.3);opacity:0.7}100%{transform:translateY(-80px) scaleY(0.1);opacity:0}}
        @keyframes cellTornado{0%{transform:rotate(0) translate(0,0);opacity:1}100%{transform:rotate(360deg) translate(80px,-40px);opacity:0}}
        @keyframes cellFreeze{0%{opacity:1;filter:hue-rotate(0)}30%{filter:hue-rotate(180deg) brightness(1.5)}60%{transform:scale(1.1)}100%{transform:scale(0.8) rotate(5deg);opacity:0;filter:hue-rotate(180deg) brightness(2)}}
        @keyframes cellDragonFire{0%{opacity:1;filter:brightness(1)}30%{filter:brightness(3) saturate(3)}100%{opacity:0;transform:scale(0.5);filter:brightness(0.1)}}
        @keyframes cellGlitch{0%{opacity:1;transform:translate(0,0)}25%{transform:translate(5px,-3px);filter:hue-rotate(90deg)}50%{transform:translate(-5px,3px);filter:hue-rotate(180deg)}75%{transform:translate(3px,5px);filter:hue-rotate(270deg)}100%{opacity:0;transform:translate(-10px,-10px);filter:hue-rotate(360deg)}}
        @keyframes cellShutterClose{0%{opacity:1;transform:scaleX(1)}30%{opacity:1;transform:scaleX(1.05)}60%{opacity:0.8;transform:scaleX(0.3)}100%{opacity:0;transform:scaleX(0);background:#3a2208}}
        @keyframes cellDrop{0%{transform:translateY(-100%);opacity:0.5}60%{transform:translateY(5%);opacity:1}80%{transform:translateY(-2%)}100%{transform:translateY(0)}}
        @keyframes rotateRowRight{0%{transform:perspective(400px) rotateY(0deg)}40%{transform:perspective(400px) rotateY(45deg);opacity:0.6}60%{transform:perspective(400px) rotateY(-10deg);opacity:0.9}100%{transform:perspective(400px) rotateY(0deg);opacity:1}}
        @keyframes rotateRowLeft{0%{transform:perspective(400px) rotateY(0deg)}40%{transform:perspective(400px) rotateY(-45deg);opacity:0.6}60%{transform:perspective(400px) rotateY(10deg);opacity:0.9}100%{transform:perspective(400px) rotateY(0deg);opacity:1}}
        @keyframes rotateColDown{0%{transform:perspective(400px) rotateX(0deg)}40%{transform:perspective(400px) rotateX(-45deg);opacity:0.6}60%{transform:perspective(400px) rotateX(10deg);opacity:0.9}100%{transform:perspective(400px) rotateX(0deg);opacity:1}}
        @keyframes rotateColUp{0%{transform:perspective(400px) rotateX(0deg)}40%{transform:perspective(400px) rotateX(45deg);opacity:0.6}60%{transform:perspective(400px) rotateX(-10deg);opacity:0.9}100%{transform:perspective(400px) rotateX(0deg);opacity:1}}
        @keyframes cellPop{0%{transform:scale(1)}50%{transform:scale(0);opacity:0}100%{transform:scale(0);opacity:0}}
        @keyframes bubbleIn{0%{opacity:0;transform:translateX(-50%) translateY(8px) scale(0.3)}30%{opacity:1;transform:translateX(-50%) translateY(-4px) scale(1.05)}50%{transform:translateX(-50%) translateY(2px) scale(0.97)}70%{transform:translateX(-50%) translateY(-1px) scale(1.01)}100%{opacity:1;transform:translateX(-50%) translateY(0) scale(1)}}
        @keyframes bubbleOut{0%{opacity:1;transform:translateX(-50%) translateY(0) scale(1)}40%{opacity:0.8;transform:translateX(-50%) translateY(-3px) scale(1.03)}100%{opacity:0;transform:translateX(-50%) translateY(10px) scale(0.3)}}
        @keyframes flagBubbleIn{0%{opacity:0;transform:translateY(8px) scale(0.3)}30%{opacity:1;transform:translateY(-4px) scale(1.05)}50%{transform:translateY(2px) scale(0.97)}70%{transform:translateY(-1px) scale(1.01)}100%{opacity:1;transform:translateY(0) scale(1)}}
        @keyframes flagBubbleOut{0%{opacity:1;transform:translateY(0) scale(1)}40%{opacity:0.8;transform:translateY(-3px) scale(1.03)}100%{opacity:0;transform:translateY(10px) scale(0.3)}}
        @keyframes themeResolve{0%{filter:blur(6px) contrast(1.8) brightness(1.3);transform:scale(1.02)}40%{filter:blur(3px) contrast(1.3) brightness(1.1)}100%{filter:none;transform:scale(1)}}
        @keyframes bubbleFloat{0%,100%{transform:translateX(-50%) translateY(0)}50%{transform:translateX(-50%) translateY(-3px)}}
        @keyframes floatUnicorn{0%,100%{transform:translateY(0) rotate(-5deg)}50%{transform:translateY(-20px) rotate(5deg)}}
        @keyframes scanlines{0%,100%{opacity:1}}
        @keyframes electricPulse{0%,100%{opacity:0.5;transform:translate(-50%,-50%) scale(1)}50%{opacity:1;transform:translate(-50%,-50%) scale(1.05)}}
        @property --rainbow-angle{syntax:'<angle>';initial-value:0deg;inherits:false}
        @keyframes rainbowSpin{from{--rainbow-angle:0deg}to{--rainbow-angle:360deg}}
        @keyframes rainbowText{0%{color:#ff4444}14%{color:#ff8844}28%{color:#ffcc44}42%{color:#44dd88}57%{color:#44aaff}71%{color:#8866ff}85%{color:#ff44cc}100%{color:#ff4444}}
        @keyframes hexPrismatic{0%{background-position:200% 0}100%{background-position:-200% 0}}
        @keyframes hexGlowPulse{0%,100%{opacity:0.3;transform:scale(0.98)}50%{opacity:0.6;transform:scale(1.02)}}
        @keyframes hexSelectPop{0%{transform:scale(0.92);opacity:0}40%{transform:scale(1.05);opacity:1}70%{transform:scale(0.98)}100%{transform:scale(1);opacity:1}}
        @keyframes hexAuroraShift{0%{filter:hue-rotate(0deg) brightness(1.05)}50%{filter:hue-rotate(15deg) brightness(1.12)}100%{filter:hue-rotate(0deg) brightness(1.05)}}
        @media(max-height:750px){
          .piilosana-title{font-size:22px!important;margin:4px 0!important;}
          .piilosana-grid{gap:4px!important;padding:5px!important;}
          .piilosana-hud{padding:3px 8px!important;}
          .piilosana-found{max-height:70px!important;padding:4px!important;}
        }
        @media(max-height:650px){
          .piilosana-title{font-size:18px!important;margin:2px 0!important;}
          .piilosana-grid{gap:3px!important;padding:4px!important;}
          .piilosana-hud{padding:2px 6px!important;}
          .piilosana-found{max-height:50px!important;padding:3px!important;}
        }
      `}</style>

      {popups.map(p=><ScorePopup key={p.id}{...p}/>)}
      {wordPopups.map(p=><WordPopup key={p.id}{...p} font={S.font}/>)}

      {(mode===null||(mode==="solo"&&state==="menu")||(mode==="public"&&publicState==="nickname")||(mode==="multi"&&(lobbyState==="enter_name"||lobbyState==="choose")))?(
        <TitleDemo active={true} lang={lang} onGearClick={()=>setShowHamburger(true)} showBubble={mode!==null&&settingsBubble} bubbleFading={bubbleFading} hideGear={mode===null} theme={S}/>
      ):(
        <div style={{display:"flex",alignItems:"center",justifyContent:"center",width:"100%",maxWidth:"600px",margin:"6px 0",position:"relative"}}>
          {(state==="play"||state==="ending"||state==="scramble")&&gameTime!==0&&(
            <span style={{position:"absolute",left:"4px",fontSize:"18px",fontWeight:"700",color:time<=15?S.red:time<=30?S.yellow:S.green,fontVariantNumeric:"tabular-nums",fontFamily:S.font}}>{fmt(time)}</span>
          )}
          {(state==="play"||state==="ending"||state==="scramble")&&gameTime===0&&(
            <span style={{position:"absolute",left:"4px",fontSize:"14px",fontWeight:"700",color:"#44ddff",fontFamily:S.font}}>{found.length} {t.words}</span>
          )}
          <h1 className="piilosana-title" style={{fontSize:"28px",letterSpacing:"4px",margin:0,display:"flex",justifyContent:"center",alignItems:"center",gap:"2px",
            animation:state==="play"&&time<=15&&gameTime!==0?"pulse 0.5s infinite":"none"}}>
            {(()=>{const tc=TITLE_CONFIG[lang]||TITLE_CONFIG.fi;const lowTime=state==="play"&&gameTime!==0&&time<=15;return tc.title.split("").map((ch,i)=>{
              const tC=lowTime?"#FF2D55":titleColor(i,tc.title.length);
              return <span key={i} style={{color:tC,textShadow:lowTime?`0 0 12px #FF2D55, 0 0 24px #FF2D5588, 2px 2px 0 #FF2D5544`:titleShadow(tC),fontFamily:S.titleFont,transition:"color 0.5s, text-shadow 0.5s"}}>{ch}</span>;
            });})()}
            {!currentLangLoaded&&<span style={{fontSize:"10px",color:S.green,marginLeft:"6px",animation:"pulse 1s ease-in-out infinite",display:"inline-flex",alignItems:"center",gap:"2px"}}><span style={{width:"6px",height:"6px",borderRadius:"50%",border:`2px solid ${S.green}`,borderTopColor:"transparent",display:"inline-block",animation:"spin 0.8s linear infinite"}}></span></span>}
          </h1>
          {(state==="play"||state==="ending"||state==="scramble")&&(
            <span style={{position:"absolute",right:"4px",fontSize:"18px",fontWeight:"700",color:S.yellow,fontVariantNumeric:"tabular-nums",fontFamily:S.font}}>{score}p.</span>
          )}
        </div>
      )}

      {/* Achievement unlock popup */}
      {newAchPopup&&ACHIEVEMENTS[newAchPopup]&&(
        <div style={{position:"fixed",top:"18%",left:"50%",transform:"translateX(-50%)",zIndex:200,
          animation:"pop 0.5s ease",pointerEvents:"none",textAlign:"center"}}>
          <div style={{background:S.dark,border:`3px solid ${ACHIEVEMENTS[newAchPopup].color}`,
            padding:"24px 36px",boxShadow:`0 0 60px ${ACHIEVEMENTS[newAchPopup].color}66`,minWidth:"280px",borderRadius:S.panelRadius}}>
            <div style={{fontSize:"16px",color:ACHIEVEMENTS[newAchPopup].color,marginBottom:"12px",fontWeight:"700",letterSpacing:"1px"}}>{t.achievementUnlocked}</div>
            <div style={{display:"flex",justifyContent:"center",marginBottom:"12px"}}>
              <Icon icon={ACHIEVEMENTS[newAchPopup].icon} color={ACHIEVEMENTS[newAchPopup].color} size={6} badge={true}/>
            </div>
            <div style={{fontSize:"20px",color:"#fff",fontWeight:"700"}}>{ACHIEVEMENTS[newAchPopup][lang]||ACHIEVEMENTS[newAchPopup].fi}</div>
            <div style={{fontSize:"14px",color:S.textSoft||"#88ccaa",marginTop:"6px"}}>{ACHIEVEMENTS[newAchPopup][lang+"_d"]||ACHIEVEMENTS[newAchPopup].fi_d}</div>
          </div>
        </div>
      )}

      {/* Achievements view */}
      {showAchievements&&(
        <AchievementsModal
          S={S}
          lang={lang}
          t={t}
          Icon={Icon}
          achievements={ACHIEVEMENTS}
          achUnlocked={achUnlocked}
          achStats={achStats}
          onClose={()=>setShowAchievements(false)}
        />
      )}


      {/* AUTH PANEL */}
      {showAuth&&(
        <AuthPanel
          S={S}
          t={t}
          lang={lang}
          Icon={Icon}
          authUser={authUser}
          authMode={authMode}
          authError={authError}
          authSuccess={authSuccess}
          authLoading={authLoading}
          googleClientId={googleClientId}
          onModeChange={(m)=>{setAuthMode(m);setAuthError("");setAuthSuccess("");}}
          onLogin={doLogin}
          onRegister={doRegister}
          onForgotPassword={doForgotPassword}
          onChangePassword={doChangePassword}
          onGoogleLogin={doGoogleLogin}
          onLogout={doLogout}
          onClose={()=>setShowAuth(false)}
        />
      )}

      {/* First-time auth prompt */}
      {mode===null&&showFirstTimeAuth&&!authUser&&!showAuth&&(
        <div style={{width:"100%",maxWidth:"500px",padding:"12px",border:`2px solid ${S.yellow}`,background:S.dark,
          boxShadow:`0 0 12px ${S.yellow}22`,animation:"fadeIn 0.5s ease",marginBottom:"8px",textAlign:"center"}}>
          <div style={{fontFamily:S.font,fontSize:"13px",color:S.yellow,marginBottom:"8px",display:"flex",alignItems:"center",justifyContent:"center",gap:"6px"}}>
            <Icon icon="person" color={S.yellow} size={2}/>
            {lang==="en"?"Save your nickname?":lang==="sv"?"Spara ditt smeknamn?":"Tallenna nimimerkkisi?"}
          </div>
          <div style={{fontFamily:S.font,fontSize:"13px",color:S.textMuted,marginBottom:"10px",lineHeight:"1.6"}}>
            {lang==="en"?"Create an account to save your progress":lang==="sv"?"Skapa ett konto för att spara dina framsteg":"Luo tunnus – nimimerkkisi ja saavutuksesi tallentuvat"}
          </div>
          <div style={{display:"flex",gap:"8px",justifyContent:"center"}}>
            <button onClick={()=>{setShowAuth(true);setAuthMode("register");setShowFirstTimeAuth(false);}}
              style={{fontFamily:S.font,fontSize:"13px",color:S.bg,background:S.yellow,border:"none",padding:"6px 16px",cursor:"pointer",boxShadow:"2px 2px 0 #cc8800"}}>
              {lang==="en"?"CREATE ACCOUNT":lang==="sv"?"SKAPA KONTO":"LUO TUNNUS"}
            </button>
            <button onClick={()=>{setShowAuth(true);setAuthMode("login");setShowFirstTimeAuth(false);}}
              style={{fontFamily:S.font,fontSize:"13px",color:S.yellow,background:"transparent",border:`1px solid ${S.yellow}`,padding:"6px 16px",cursor:"pointer"}}>
              {lang==="en"?"LOG IN":lang==="sv"?"LOGGA IN":"KIRJAUDU"}
            </button>
            <button onClick={()=>{setShowFirstTimeAuth(false);sessionStorage.setItem("piilosana_auth_dismissed","1");}}
              style={{fontFamily:S.font,fontSize:"14px",color:S.textMuted,background:"transparent",border:`2px solid ${S.border}`,padding:"4px 12px",cursor:"pointer"}}>✕</button>
          </div>
        </div>
      )}

      {/* MENU */}
      {/* MODE SELECT */}
      {mode===null&&modeSelectJSX}
      
      {/* MULTIPLAYER SCREENS - inline to prevent focus loss */}
      {mode==="multi"&&lobbyState==="enter_name"&&(
        <LobbyEnterName
          S={S}
          t={t}
          lang={lang}
          nickname={nickname}
          nicknameRef={nicknameRef}
          onNicknameChange={setNickname}
          onContinue={()=>setLobbyState("choose")}
          onBack={returnToModeSelect}
        />
      )}
      {mode==="multi"&&(lobbyState==="creating"||lobbyState==="joining")&&(
        <div style={{textAlign:"center",marginTop:"30px",animation:"fadeIn 0.5s ease"}}>
          <div style={{border:`3px solid ${S.yellow}`,padding:"24px",boxShadow:`0 0 20px ${S.yellow}44`,maxWidth:"600px"}}>
            <p style={{fontSize:"13px",lineHeight:"2",color:S.yellow,animation:"pulse 1s infinite"}}>
              {lobbyState==="creating"?"LUODAAN HUONETTA...":"LIITYTÄÄN HUONEESEEN..."}
            </p>
          </div>
        </div>
      )}
      {mode==="multi"&&lobbyState==="choose"&&(
        <LobbyChoose
          S={S}
          t={t}
          Icon={Icon}
          PixelFlag={PixelFlag}
          socketConnected={socketConnected}
          lobbyError={lobbyError}
          publicRooms={publicRooms}
          roomCode={roomCode}
          onRoomCodeChange={setRoomCode}
          onJoinRoom={joinRoom}
          onCreateRoom={createRoom}
          onRefreshRooms={refreshRooms}
          onBack={returnToModeSelect}
        />
      )}
      {mode==="multi"&&lobbyState==="waiting"&&(
        <LobbyWaiting
          S={S}
          t={t}
          lang={lang}
          Icon={Icon}
          players={players}
          playerId={playerId}
          roomCode={roomCode}
          linkCopied={linkCopied}
          isHost={isHost}
          gameMode={gameMode}
          gameTime={gameTime}
          letterMult={letterMult}
          onCopyLink={()=>{
            const shareUrl=`${window.location.origin}?room=${roomCode}`;
            navigator.clipboard.writeText(shareUrl).then(()=>{
              setLinkCopied(true);
              setTimeout(()=>setLinkCopied(false),2000);
            }).catch(()=>{});
          }}
          onGameModeChange={setGameMode}
          onGameTimeChange={setGameTime}
          onLetterMultToggle={()=>setLetterMult(v=>!v)}
          onStartGame={startGame}
          onExit={returnToModeSelect}
        />
      )}
      {mode==="multi"&&state==="end"&&lobbyState==="results"&&<ResultsScreen/>}

      {/* PIILOSAUNA - nickname entry */}
      {mode==="public"&&publicState==="nickname"&&(
        <div style={{textAlign:"center",marginTop:"30px",animation:"fadeIn 0.5s ease"}}>
          <div style={{border:"1px solid #ff664444",padding:"24px",boxShadow:"0 4px 24px #ff664422, 0 8px 32px #00000022",maxWidth:"600px",borderRadius:"16px",background:`${S.dark}f0`,backdropFilter:"blur(12px)",WebkitBackdropFilter:"blur(12px)"}}>
            <p style={{fontSize:"18px",color:"#ff6644",marginBottom:"8px"}}>{t.arena}</p>
            <p style={{fontSize:"14px",color:S.textSoft||"#88ccaa",marginBottom:"16px",lineHeight:"1.8"}}>{t.arenaJoinDesc}</p>
            <p style={{fontSize:"13px",color:S.green,marginBottom:"8px"}}>{t.nickname}</p>
            <input type="text" maxLength="12" value={soloNickname} onChange={e=>setSoloNickname(e.target.value.toUpperCase())}
              placeholder={t.nickname} style={{fontFamily:S.font,fontSize:"13px",color:S.green,background:S.dark,
              border:`2px solid ${S.green}`,padding:"10px",width:"200px",textAlign:"center",outline:"none",marginBottom:"16px"}}
              onKeyDown={e=>{if(e.key==="Enter"&&soloNickname.trim()&&socket){
                localStorage.setItem("piilosana_nick",soloNickname);
                socket.emit("join_public",{nickname:soloNickname.trim(),lang});
                setPublicState("waiting");
              }}}/>
            <div style={{display:"flex",gap:"8px",justifyContent:"center"}}>
              <button onClick={()=>{
                if(!soloNickname.trim()||!socket)return;
                localStorage.setItem("piilosana_nick",soloNickname);
                socket.emit("join_public",{nickname:soloNickname.trim(),lang});
                setPublicState("waiting");
              }} disabled={!soloNickname.trim()}
                style={{fontFamily:S.font,fontSize:"13px",color:soloNickname.trim()?S.bg:S.textMuted,
                background:soloNickname.trim()?"#ff6644":S.border,border:"none",padding:"12px 24px",
                cursor:soloNickname.trim()?"pointer":"default",boxShadow:soloNickname.trim()?"3px 3px 0 #cc3311":"none"}}>
                {t.join}
              </button>
              <button onClick={returnToModeSelect} style={{fontFamily:S.font,fontSize:"13px",color:S.green,border:`2px solid ${S.green}`,background:"transparent",padding:"8px 20px",cursor:"pointer"}}>{t.back}</button>
            </div>
          </div>
        </div>
      )}

      {/* AREENA - waiting for round */}
      {mode==="public"&&publicState==="waiting"&&(()=>{
        const arenaUrl=`${window.location.origin}?arena`;
        const copyArena=()=>{navigator.clipboard.writeText(arenaUrl).then(()=>{setLinkCopied(true);setTimeout(()=>setLinkCopied(false),2000);}).catch(()=>{});};
        return(
        <div style={{textAlign:"center",marginTop:"60px",animation:"fadeIn 0.5s ease"}}>
          <p style={{fontSize:"22px",color:"#ff6644"}}>{t.arena}</p>
          {publicNextCountdown>0?(
            <>
              <p style={{fontSize:"15px",color:S.textMuted,marginTop:"12px"}}>{t.nextRound}</p>
              <p style={{fontSize:"28px",color:S.green,marginTop:"8px",animation:publicNextCountdown<=5?"pulse 0.5s infinite":"none"}}>{publicNextCountdown}s</p>
            </>
          ):(
            <p style={{fontSize:"15px",color:S.textMuted,marginTop:"12px",animation:"pulse 1s infinite"}}>{lang==="en"?"Connecting...":lang==="sv"?"Ansluter...":"Yhdistetään..."}</p>
          )}
          <p style={{fontSize:"15px",color:S.textSoft||"#88ccaa",marginTop:"8px"}}>{publicPlayerCount} {publicPlayerCount===1?t.playerInArena:t.playersInArena}</p>
          {/* Share arena link */}
          <div style={{marginTop:"20px",padding:"12px",background:S.gridBg,border:`1px solid ${S.border}`,borderRadius:"4px",maxWidth:"320px",margin:"20px auto 0"}}>
            <p style={{fontSize:"12px",color:S.textMuted,marginBottom:"8px"}}>{t.arenaLink}</p>
            <div style={{display:"flex",gap:"6px",alignItems:"center",justifyContent:"center",marginBottom:"10px"}}>
              <input readOnly value={arenaUrl} style={{fontFamily:S.font,fontSize:"11px",color:S.textSoft,background:S.dark,border:`1px solid ${S.border}`,padding:"5px 8px",flex:1,outline:"none"}} onClick={e=>e.target.select()}/>
              <button onClick={copyArena} style={{fontFamily:S.font,fontSize:"11px",color:linkCopied?S.bg:S.green,background:linkCopied?S.green:"transparent",border:`2px solid ${S.green}`,padding:"5px 10px",cursor:"pointer",minWidth:"70px",transition:"all 0.2s"}}>{linkCopied?t.copied:t.shareLink}</button>
            </div>
            <QRCodeSVG value={arenaUrl} size={100} bgColor="transparent" fgColor={S.textSoft} level="L"/>
          </div>
          <button onClick={returnToModeSelect} style={{fontFamily:S.font,fontSize:"13px",color:S.green,border:`2px solid ${S.green}`,background:"transparent",padding:"8px 20px",cursor:"pointer",marginTop:"16px"}}>{t.back}</button>
        </div>);
      })()}

      {/* PIILOSAUNA - countdown */}
      {mode==="public"&&publicState==="countdown"&&(
        <div style={{textAlign:"center",marginTop:"60px",animation:"fadeIn 0.5s ease"}}>
          <div style={{fontSize:"18px",color:"#ff6644",marginBottom:"24px"}}>{t.arena}</div>
          <div style={{fontSize:"15px",color:S.green,marginBottom:"8px"}}>{publicPlayerCount} {publicPlayerCount===1?t.playerInArena:t.playersInArena}</div>
          <div style={{fontSize:"18px",color:S.green}}>{t.getReady}</div>
        </div>
      )}

      {/* PIILOSAUNA - end of round */}
      {mode==="public"&&publicState==="end"&&(()=>{
        const MEDALS=["🥇","🥈","🥉"];
        const publicMissed=valid.size>0?[...valid].filter(w=>!publicAllFound.includes(w)).sort((a,b)=>b.length-a.length):[];
        const publicFoundSorted=[...publicAllFound].sort((a,b)=>b.length-a.length);
        const secStyle={border:`1px solid ${S.border}`,padding:"14px",background:`${S.dark}ee`,marginBottom:"12px",textAlign:"left",borderRadius:"12px",backdropFilter:"blur(8px)",WebkitBackdropFilter:"blur(8px)"};
        const secTitle={fontSize:"14px",fontWeight:"bold",marginBottom:"8px",letterSpacing:"0.5px"};
        return(
        <div style={{width:"100%",maxWidth:"600px",textAlign:"center",animation:"fadeIn 1s ease"}}>
          {/* Your score */}
          <div style={{border:`1px solid ${S.green}44`,padding:"24px",marginBottom:"16px",boxShadow:`0 4px 24px ${S.green}22, 0 8px 32px #00000022`,background:`${S.dark}f0`,borderRadius:"16px",backdropFilter:"blur(12px)",WebkitBackdropFilter:"blur(12px)"}}>
            <div style={{fontSize:"13px",color:S.green,marginBottom:"4px",letterSpacing:"1px"}}>{t.roundOver}</div>
            <div style={{fontSize:"28px",color:S.green,marginBottom:"2px",marginTop:"8px",animation:"pop 0.3s ease"}}>{score}<span style={{fontSize:"14px",color:S.textSoft,marginLeft:"4px"}}>/ {[...valid].reduce((s,w)=>s+pts(w.length),0)}p</span></div>
            <div style={{fontSize:"13px",color:S.textSoft,marginTop:"6px"}}>{found.length} / {valid.size} {t.words} ({valid.size>0?Math.round(found.length/valid.size*100):0}%)</div>
            <div style={{fontSize:"13px",color:publicNextCountdown<=10?"#ffaa33":S.textSoft,marginTop:"12px",fontWeight:publicNextCountdown<=10?"bold":"normal"}}>
              {t.nextRoundIn}: {publicNextCountdown>0?`${publicNextCountdown}s`:t.starts}
            </div>
            <div style={{display:"flex",gap:"8px",justifyContent:"center",marginTop:"10px"}}>
              <button onClick={()=>setShowSharePopup(true)} style={{fontFamily:S.font,fontSize:"13px",color:S.yellow||"#ffcc00",border:`2px solid ${S.yellow||"#ffcc00"}`,background:"transparent",padding:"8px 16px",cursor:"pointer",display:"flex",alignItems:"center",gap:"6px"}}><Icon icon="share" color={S.yellow||"#ffcc00"} size={1.5}/>{t.invitePlayer}</button>
              <button onClick={returnToModeSelect} style={{fontFamily:S.font,fontSize:"13px",color:S.green,border:`2px solid ${S.green}`,background:"transparent",padding:"8px 20px",cursor:"pointer"}}>{t.exit}</button>
            </div>
          </div>

          {/* Rankings with medals */}
          {publicRankings&&publicRankings.length>0&&(
            <div style={{...secStyle,animation:"fadeIn 0.8s ease"}}>
              <div style={{...secTitle,color:S.textSoft}}>{t.roundResults}</div>
              <div style={{display:"flex",flexDirection:"column",gap:"2px"}}>
                {publicRankings.slice(0,10).map((r,i)=>{
                  const isMe=r.nickname===soloNickname;
                  return(
                  <div key={i} style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:i===0?"7px 8px":"5px 8px",
                    background:isMe?`${S.green}15`:i<3?["#ffcc0015","#cccccc10","#cc884410"][i]:"transparent",
                    border:isMe?`1px solid ${S.green}33`:i<3?`1px solid ${["#ffcc0033","#cccccc33","#cc884433"][i]}`:"1px solid transparent",
                    borderRadius:"8px",marginBottom:"1px"}}>
                    <div style={{display:"flex",gap:"8px",alignItems:"center"}}>
                      <span style={{fontSize:"16px",minWidth:"24px"}}>{i<3?MEDALS[i]:<span style={{fontSize:"13px",color:S.textMuted}}>{i+1}.</span>}</span>
                      <span style={{fontSize:i===0?"15px":"14px",color:isMe?S.green:i===0?S.yellow:i<3?"#cccccc":S.textSoft,fontWeight:isMe||i<3?"bold":"normal"}}>{r.nickname}</span>
                    </div>
                    <div style={{display:"flex",gap:"12px",alignItems:"center"}}>
                      <span style={{fontSize:i===0?"15px":"14px",color:i===0?S.yellow:S.green,fontWeight:"bold"}}>{r.score}p</span>
                      <span style={{fontSize:"13px",color:S.textSoft}}>{r.percentage}%</span>
                      <span style={{fontSize:"12px",color:S.textMuted}}>{r.wordsFound} {t.words}</span>
                    </div>
                  </div>);
                })}
              </div>
            </div>
          )}

          {/* All found words (collective) */}
          {publicFoundSorted.length>0&&(
            <div style={{...secStyle,animation:"fadeIn 0.8s ease"}}>
              <div style={{...secTitle,color:S.green}}>{t.foundWords} ({publicFoundSorted.length})</div>
              <div style={{display:"flex",flexWrap:"wrap",gap:"4px"}}>
                {publicFoundSorted.map((w,i)=>(
                  <span key={i} onClick={e=>showDef(w,e)} style={{fontSize:"14px",background:found.includes(w)?S.dark:S.gridBg,padding:"2px 5px",
                    border:`1px solid ${found.includes(w)?wordColor(w.length)+"44":"#33333366"}`,
                    color:found.includes(w)?wordColor(w.length):"#667",cursor:DEFS&&DEFS[w.toLowerCase()]?"pointer":"default",textDecoration:DEFS&&DEFS[w.toLowerCase()]?"underline dotted":"none",textUnderlineOffset:"3px"}}>{w.toUpperCase()}</span>
                ))}
              </div>
              <div style={{fontSize:"12px",color:S.textMuted,marginTop:"6px"}}>{t.ownHighlighted}{DEFS?" · "+t.defHint:""}</div>
            </div>
          )}

          {/* Missed words */}
          {publicMissed.length>0&&(
            <div style={{...secStyle,maxHeight:"180px",overflowY:"auto",animation:"fadeIn 1s ease"}}>
              <div style={{...secTitle,color:"#ff8877"}}>{t.missed} ({publicMissed.length})</div>
              <div style={{display:"flex",flexWrap:"wrap",gap:"4px"}}>
                {publicMissed.map((w,i)=>(
                  <span key={i} onClick={e=>showDef(w,e)} style={{fontSize:"14px",background:S.dark,padding:"2px 5px",border:"1px solid #ff444444",color:"#ff8877",cursor:DEFS&&DEFS[w.toLowerCase()]?"pointer":"default",textDecoration:DEFS&&DEFS[w.toLowerCase()]?"underline dotted":"none",textUnderlineOffset:"3px"}}>{w.toUpperCase()}</span>
                ))}
              </div>
              {lang==="fi"&&<div style={{fontSize:"12px",color:S.textMuted,marginTop:"8px",fontStyle:"italic"}}>{t.missedLong||"Laudalta löytyi myös pidempiä sanoja"}</div>}
            </div>
          )}

          {/* Hall of Fame */}
          <HallOfFame gameMode="normal" gameTime={120} currentScore={score} S={S} lang={lang}/>
        </div>
        );
      })()}

      {/* SOLO MENU - just play button */}
      {mode==="solo"&&state==="menu"&&(
        <div style={{textAlign:"center",marginTop:"30px",animation:"fadeIn 0.5s ease"}}>
          {/* Mode selection removed — hex only */}
          <div style={{marginBottom:"16px"}}>
            <p style={{fontSize:"13px",color:S.green,marginBottom:"8px"}}>{t.time}</p>
            <div style={{display:"flex",gap:"8px",justifyContent:"center"}}>
              <button onClick={()=>setGameTime(120)} style={{fontFamily:S.font,fontSize:"13px",color:gameTime===120?S.bg:S.green,background:gameTime===120?S.green:"transparent",border:`2px solid ${S.green}`,padding:"8px 16px",cursor:"pointer"}}>2 MIN</button>
              <button onClick={()=>setGameTime(402)} style={{fontFamily:S.font,fontSize:"13px",color:gameTime===402?S.bg:S.yellow,background:gameTime===402?S.yellow:"transparent",border:`2px solid ${S.yellow}`,padding:"8px 16px",cursor:"pointer"}}>{lang==="en"?"6.7":"6,7"} MIN</button>
              <button onClick={()=>setGameTime(0)} style={{fontFamily:S.font,fontSize:"13px",color:gameTime===0?S.bg:"#44ddff",background:gameTime===0?"#44ddff":"transparent",border:"2px solid #44ddff",padding:"8px 16px",cursor:"pointer",display:"flex",alignItems:"center",gap:"6px"}}><Icon icon="infinity" color={gameTime===0?S.bg:"#44ddff"} size={2}/>{t.unlimited}</button>
            </div>
            {gameTime===0&&<p style={{fontSize:"13px",color:"#44ddff",marginTop:"8px",lineHeight:"1.8"}}>{t.unlimitedDesc}</p>}
          </div>
          <div style={{marginBottom:"16px"}}>
            <p style={{fontSize:"13px",color:S.green,marginBottom:"8px"}}>{t.otherOptions}</p>
            <div style={{display:"flex",gap:"8px",justifyContent:"center"}}>
              <button onClick={()=>setLetterMult(v=>!v)} style={{fontFamily:S.font,fontSize:"13px",color:letterMult?S.bg:S.yellow,background:letterMult?S.yellow:"transparent",border:`2px solid ${S.yellow}`,padding:"8px 16px",cursor:"pointer"}}>
                {letterMult?"✓ ":""}{t.letterMultBtn}
              </button>
            </div>
            {letterMult&&<p style={{fontSize:"13px",color:S.yellow,marginTop:"6px",lineHeight:"1.8"}}>{t.letterMultDesc}</p>}
          </div>
          {gameTime!==0&&!authUser&&(
          <div style={{marginBottom:"16px"}}>
            <p style={{fontSize:"13px",color:S.textMuted,marginBottom:"6px"}}>{t.nickForHof}</p>
            <input type="text" maxLength="12" value={soloNickname} onChange={e=>{setSoloNickname(e.target.value.toUpperCase());localStorage.setItem("piilosana_nick",e.target.value.toUpperCase());}}
              placeholder={t.optional} style={{fontFamily:S.font,fontSize:"13px",color:S.green,background:S.dark,
              border:`2px solid ${S.border}`,padding:"8px",width:"160px",textAlign:"center",outline:"none"}}/>
            {soloNickname.trim()&&<p style={{fontSize:"13px",color:S.textSoft||"#88ccaa",marginTop:"4px"}}>{t.scoresSaved} {soloNickname.trim()}</p>}
          </div>
          )}
          {gameTime!==0&&authUser&&(
          <div style={{marginBottom:"16px"}}>
            <p style={{fontSize:"13px",color:S.textSoft||"#88ccaa"}}>{t.scoresSaved} {authUser.nickname}</p>
          </div>
          )}
          <div style={{display:"flex",gap:"12px",justifyContent:"center",alignItems:"center"}}>
            <button onClick={start} style={{fontFamily:S.font,fontSize:"18px",color:S.bg,background:S.green,border:"none",padding:"14px 32px",cursor:"pointer",boxShadow:"4px 4px 0 #008844"}}
              onMouseEnter={e=>{e.target.style.transform="translate(-2px,-2px)";e.target.style.boxShadow="6px 6px 0 #008844"}}
              onMouseLeave={e=>{e.target.style.transform="none";e.target.style.boxShadow="4px 4px 0 #008844"}}>
              {t.play}
            </button>
            <button onClick={returnToModeSelect} style={{fontFamily:S.font,fontSize:"13px",color:S.green,border:`2px solid ${S.green}`,background:"transparent",padding:"8px 20px",cursor:"pointer"}}>{t.back}</button>
          </div>
        </div>
      )}

      {/* COUNTDOWN */}
      {state==="countdown"&&(
        <div style={{textAlign:"center",marginTop:"60px",animation:"fadeIn 0.5s ease"}}>
          <div style={{fontSize:"13px",color:S.green,marginBottom:"24px"}}>{mode==="multi"?(gameMode==="battle"?t.battleStarts:t.gameStarts):(soloMode==="tetris"?t.tetrisStarts:soloMode==="rotate"?t.rotateStarts:soloMode==="theme"?t.themeStarts:soloMode==="bomb"?t.bombStarts:soloMode==="mystery"?t.mysteryStarts:soloMode==="chess"?`${CHESS_EMOJI[chessPiece]||"♞"} ${t.chessLabel}`:t.getReady)}</div>
          <div key={countdown} style={{fontSize:"72px",color:countdown<=2?S.red:countdown<=3?S.yellow:S.green,textShadow:`0 0 40px ${countdown<=2?"#ff444488":countdown<=3?"#ffcc0088":"#00ff8888"}`,animation:"pop 0.3s ease",lineHeight:"1"}}>
            {countdown>0?countdown:t.play+"!"}
          </div>
          {mode==="multi"&&<div style={{fontSize:"18px",color:S.textMuted,marginTop:"24px"}}>{players.length} {t.players}</div>}
        </div>
      )}

      {/* PLAYING + ENDING + SCRAMBLE */}
      {(state==="play"||state==="ending"||state==="scramble")&&(
        <div style={{width:"100%",maxWidth:"600px",position:"relative",padding:(soloMode==="hex"||mode==="multi"||(mode==="public"&&publicHex))?"0":"0 2px",display:"flex",flexDirection:"column",flex:"1 1 auto",minHeight:0}}>
          {/* HUD + emoji picker wrapper */}
          <div style={{position:"relative",zIndex:10,marginBottom:isHexMode?"1px":"4px"}}>
          {/* HUD */}
          <div style={{border:`1px solid ${S.border}`,background:`${S.dark}ee`,borderRadius:"12px",backdropFilter:"blur(12px)",WebkitBackdropFilter:"blur(12px)",boxShadow:"0 2px 12px #00000022",overflow:"hidden"}}>

            {mode==="multi"&&gameMode==="battle"&&<div style={{textAlign:"center",padding:"1px",fontSize:"11px",color:S.purple,background:"#ff66ff11",borderBottom:`1px solid ${S.border}`,display:"flex",alignItems:"center",justifyContent:"center",gap:"4px"}}><Icon icon="swords" color={S.purple} size={1}/>{t.battleLabel}</div>}
            {mode==="solo"&&soloMode==="tetris"&&<div style={{textAlign:"center",padding:"1px",fontSize:"11px",color:S.purple,background:"#ff66ff11",borderBottom:`1px solid ${S.border}`,display:"flex",alignItems:"center",justifyContent:"center",gap:"4px"}}><Icon icon="arrow" color={S.purple} size={1}/>{t.tetrisLabel}</div>}
            {mode==="solo"&&soloMode==="rotate"&&(
              <div style={{display:"flex",alignItems:"center",justifyContent:"center",gap:"8px",padding:"4px",
                background:rotateActive?"#ff990022":"#ff990008",borderBottom:`1px solid ${S.border}`,transition:"background 0.2s"}}>
                <button onClick={()=>setRotateActive(a=>!a)}
                  style={{fontFamily:S.font,fontSize:"13px",padding:"4px 14px",cursor:"pointer",borderRadius:S.btnRadius,
                    border:rotateActive?"2px solid #ff9900":`2px solid ${S.border}`,
                    background:rotateActive?"#ff9900":"transparent",
                    color:rotateActive?S.bg:"#ff9900",
                    transition:"all 0.2s",display:"flex",alignItems:"center",gap:"5px"}}>
                  {rotateActive?"🔄":"✋"} {rotateActive?(lang==="en"?"ROTATING":lang==="sv"?"ROTERA":"PYÖRITÄ"):(lang==="en"?"FIND WORDS":lang==="sv"?"HITTA ORD":"ETSI SANOJA")}
                </button>
                <span style={{fontSize:"13px",color:"#ff990088"}}>{rotateCount>0?`${rotateCount} ${lang==="en"?"moves":lang==="sv"?"drag":"siirtoa"}`:""}</span>
              </div>
            )}
            {mode==="solo"&&soloMode==="theme"&&activeTheme&&<div style={{textAlign:"center",padding:"3px",fontSize:"13px",color:"#44bb66",background:"#44bb6611",borderBottom:`1px solid ${S.border}`,display:"flex",alignItems:"center",justifyContent:"center",gap:"6px"}}>{activeTheme.emoji} {t.themeHint}: {activeTheme.name} — {themeFound.length}/{activeTheme.words.length}</div>}
            {mode==="solo"&&soloMode==="bomb"&&<div style={{textAlign:"center",padding:"3px",fontSize:"13px",color:"#ff4444",background:"#ff444411",borderBottom:`1px solid ${S.border}`,display:"flex",alignItems:"center",justifyContent:"center",gap:"6px"}}>💣 {t.bombLabel} — {bombTimer}s</div>}
            {mode==="solo"&&soloMode==="mystery"&&<div style={{textAlign:"center",padding:"3px",fontSize:"13px",color:"#aa66ff",background:"#aa66ff11",borderBottom:`1px solid ${S.border}`,display:"flex",alignItems:"center",justifyContent:"center",gap:"6px"}}>❓ {t.mysteryLabel}</div>}
            {dailyMode&&dailyTheme&&<div style={{textAlign:"center",padding:"3px",fontSize:"12px",color:S.yellow||"#ffcc00",background:`${S.yellow||"#ffcc00"}11`,borderBottom:`1px solid ${S.border}`,display:"flex",alignItems:"center",justifyContent:"center",gap:"5px",fontStyle:"italic"}}>{lang==="en"?"Theme":lang==="sv"?"Tema":"Teema"}: {lang==="en"?dailyTheme.nameEn||dailyTheme.name:lang==="sv"?dailyTheme.nameSv||dailyTheme.name:dailyTheme.name} {dailyThemeFound.length>0?<span style={{fontSize:"11px",fontWeight:"700",color:dailyThemeBonusGiven?(S.green||"#44ddaa"):(S.yellow||"#ffcc00")}}>🎯 {dailyThemeFound.length}{dailyThemeBonusGiven?` ✓ +${DAILY_THEME_BONUS}`:dailyThemeFound.length<DAILY_THEME_THRESHOLD?`/${DAILY_THEME_THRESHOLD}`:""}</span>:<span style={{fontSize:"10px",opacity:0.7}}>🎯 {lang==="en"?`Find ${DAILY_THEME_THRESHOLD} → +${DAILY_THEME_BONUS}p`:lang==="sv"?`Hitta ${DAILY_THEME_THRESHOLD} → +${DAILY_THEME_BONUS}p`:`Löydä ${DAILY_THEME_THRESHOLD} → +${DAILY_THEME_BONUS}p`}</span>}</div>}
            {mode==="solo"&&soloMode==="chess"&&state==="play"&&chessPiece&&(
              <div style={{textAlign:"center",padding:"8px",fontSize:"13px",color:"#ddaa33",background:"#ddaa3311",borderBottom:`1px solid ${S.border}`}}>
                {chessPlacing?(
                  <div style={{display:"flex",alignItems:"center",justifyContent:"center",gap:"10px"}}>
                    <span style={{fontSize:"42px",color:"#fff",filter:"drop-shadow(0 0 10px #ddaa33) drop-shadow(0 2px 4px #000)",WebkitTextStroke:"1px rgba(221,170,51,0.6)"}}>{CHESS_EMOJI[chessPiece]}</span>
                    <div style={{textAlign:"left"}}>
                      <div style={{fontSize:"12px",color:"#ddaa33",fontFamily:S.font,textTransform:"uppercase",letterSpacing:"1px"}}>{(CHESS_NAMES[lang]||CHESS_NAMES.fi)[chessPiece]}</div>
                      <div style={{fontSize:"13px",color:"#ddaa3388",marginTop:"2px"}}>{lang==="en"?"Place on bottom row":lang==="sv"?"Placera på nedersta raden":"Aseta alariville ↓"}</div>
                    </div>
                  </div>
                ):(
                  <div style={{display:"flex",alignItems:"center",justifyContent:"center",gap:"8px",flexWrap:"wrap"}}>
                    <span style={{fontSize:"32px",color:"#fff",filter:"drop-shadow(0 0 6px #ddaa33)",WebkitTextStroke:"0.5px rgba(221,170,51,0.4)"}}>{CHESS_EMOJI[chessPiece]}</span>
                    <div style={{textAlign:"left"}}>
                      <div style={{fontSize:"11px",color:"#ddaa3388",fontFamily:S.font,textTransform:"uppercase"}}>{(CHESS_NAMES[lang]||CHESS_NAMES.fi)[chessPiece]}</div>
                      <div style={{fontSize:"16px",fontFamily:S.font,letterSpacing:"2px",color:chessWord.length>=3&&WORDS_SET.has(chessWord)?"#44bb66":"#fff",fontWeight:"700"}}>{chessWord.toUpperCase()||"..."}</div>
                    </div>
                    <div style={{display:"flex",gap:"4px",marginLeft:"auto"}}>
                      <button onClick={chessSubmitWord} disabled={chessWord.length<3} style={{fontFamily:S.font,fontSize:"13px",color:chessWord.length>=3?"#fff":"#555",background:chessWord.length>=3?"#44bb66":"#333",border:"none",padding:"5px 14px",cursor:chessWord.length>=3?"pointer":"default",borderRadius:S.btnRadius,transition:"all 0.2s"}}>✓</button>
                      <button onClick={chessUndo} disabled={chessPath.length<1} style={{fontFamily:S.font,fontSize:"13px",color:chessPath.length>=1?"#ddaa33":"#444",background:"transparent",border:`1px solid ${chessPath.length>=1?"#ddaa3366":"#33333366"}`,padding:"5px 10px",cursor:chessPath.length>=1?"pointer":"default",borderRadius:S.btnRadius}}>↩</button>
                      <button onClick={chessReset} style={{fontFamily:S.font,fontSize:"13px",color:"#ddaa33",background:"transparent",border:"1px solid #ddaa3366",padding:"5px 10px",cursor:"pointer",borderRadius:S.btnRadius}}>⟳</button>
                    </div>
                  </div>
                )}
              </div>
            )}
            {mode==="solo"&&gameTime===0&&<div style={{textAlign:"center",padding:"3px",fontSize:"13px",color:"#44ddff",background:"#44ddff11",borderBottom:`1px solid ${S.border}`,display:"flex",alignItems:"center",justifyContent:"center",gap:"6px"}}><Icon icon="infinity" color="#44ddff" size={1}/>{t.unlimitedLabel}</div>}
            {letterMult&&<div style={{textAlign:"center",padding:"3px",fontSize:"13px",color:S.yellow,background:"#ffcc0011",borderBottom:`1px solid ${S.border}`}}>{t.letterMultLabel}</div>}
            <div ref={wordBarRef} key={flashKey} style={{padding:S.cellGradient?"4px 10px":"2px 8px",textAlign:"center",position:"relative",animation:"none",background:S.cellGradient?S.dark:"transparent",borderRadius:S.cellGradient?"0 0 12px 12px":"0"}}>
              {/* Hamburger menu button */}
              <button onClick={()=>setShowHamburger(true)} style={{position:"absolute",left:"6px",top:"50%",transform:"translateY(-50%)",background:"transparent",border:`1px solid ${S.textMuted}44`,padding:"4px 10px",cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center",borderRadius:"8px",transition:"all 0.15s",zIndex:2,fontSize:"20px",color:S.textMuted,lineHeight:1}}
                onMouseEnter={e=>{e.currentTarget.style.borderColor=S.green;e.currentTarget.style.background=S.green+"15";e.currentTarget.style.color=S.green;}}
                onMouseLeave={e=>{e.currentTarget.style.borderColor=S.textMuted+"44";e.currentTarget.style.background="transparent";e.currentTarget.style.color=S.textMuted;}}>
                &#9776;
              </button>
              <div style={{fontSize:S.cellGradient?"28px":"18px",minHeight:S.cellGradient?"32px":"20px",fontWeight:S.cellGradient?"700":"normal",letterSpacing:S.cellGradient?"3px":"0",animation:shake?"shake 0.4s":(!word&&msg?.ok?"scoreJump 0.4s ease-out":"none"),color:word?wordColor(word.length):undefined,transition:"all 0.15s ease"}}>
                {state==="ending"?<span style={{color:ending?.color,fontSize:S.cellGradient?"18px":"16px",animation:"pulse 1s infinite"}}>{ending?.emoji} {ending?.name}</span>:
                 word?word.toUpperCase():
                 (msg?<span style={{color:msg.ok?S.green:S.red,fontSize:msg.ok?(S.cellGradient?"16px":"12px"):(S.cellGradient?"14px":"10px"),fontWeight:msg.ok?"bold":"normal"}}>{msg.ok?`${msg.t?.toUpperCase()} +${msg.p}p${msg.combo>=3?` ${T[lang]?.combo||"COMBO"}!`:""}`:msg.m}</span>:<span style={{color:S.textMuted,fontSize:S.cellGradient?"20px":"18px"}}>···</span>)}
              </div>
              {(mode==="multi"||mode==="public")&&<span style={{position:"absolute",right:"4px",top:"50%",transform:"translateY(-50%)",fontSize:"13px",color:S.textMuted,display:"flex",alignItems:"center",gap:"6px",padding:"4px 8px"}}>
                <span style={{display:"flex",alignItems:"center",gap:"3px"}}><Icon icon="person" color={S.textMuted} size={1.5}/>{mode==="public"?publicPlayerCount:players.length}</span>
                <button onClick={e=>{e.stopPropagation();setEmojiOpen(o=>o==="open"?false:"open");}} style={{background:emojiOpen==="open"?S.green+"22":"transparent",border:`1px solid ${emojiOpen==="open"?S.green+"66":S.textMuted+"44"}`,padding:"2px 6px",cursor:"pointer",borderRadius:"6px",fontSize:"14px",lineHeight:1,transition:"all 0.15s",color:emojiOpen==="open"?S.green:S.textMuted}} onMouseEnter={e=>{e.currentTarget.style.borderColor=S.green;e.currentTarget.style.color=S.green;}} onMouseLeave={e=>{e.currentTarget.style.borderColor=emojiOpen==="open"?S.green+"66":S.textMuted+"44";e.currentTarget.style.color=emojiOpen==="open"?S.green:S.textMuted;}}>💬</button>
              </span>}
            </div>
          </div>

          {/* Emoji picker dropdown - multiplayer only — absolute, anchored to HUD wrapper */}
          {(mode==="multi"||mode==="public")&&emojiOpen==="open"&&socket&&state==="play"&&(
            <div style={{position:"absolute",top:"100%",left:0,right:0,zIndex:50,animation:"fadeIn 0.15s ease",pointerEvents:"none"}} onClick={()=>setEmojiOpen(false)}>
              <div style={{background:`${S.dark}f0`,border:`1px solid ${S.border}`,borderRadius:"12px",padding:"8px",margin:"2px 0",backdropFilter:"blur(12px)",WebkitBackdropFilter:"blur(12px)",boxShadow:"0 4px 16px #00000033",pointerEvents:"auto"}} onClick={e=>e.stopPropagation()}>
                <div style={{display:"grid",gridTemplateColumns:"repeat(8,1fr)",gap:"2px"}}>
                  {["😀","😎","🤔","😮","🔥","💪","🎯","👀","😭","🤣","😱","🥳","👏","❤️","💀","🫡"].map(em=>(
                    <button key={em} onClick={()=>{socket.emit("emoji_reaction",{emoji:em});setEmojiOpen(false);}}
                      style={{fontSize:"20px",padding:"6px",background:"transparent",border:"none",borderRadius:"8px",cursor:"pointer",lineHeight:1,
                      transition:"transform 0.12s, background 0.12s"}}
                      onMouseDown={e=>{e.currentTarget.style.transform="scale(1.2)";e.currentTarget.style.background=S.green+"22";}}
                      onMouseUp={e=>{e.currentTarget.style.transform="scale(1)";e.currentTarget.style.background="transparent";}}
                      onMouseLeave={e=>{e.currentTarget.style.transform="scale(1)";e.currentTarget.style.background="transparent";}}
                      onTouchStart={e=>{e.currentTarget.style.transform="scale(1.2)";e.currentTarget.style.background=S.green+"22";}}
                      onTouchEnd={e=>{e.currentTarget.style.transform="scale(1)";e.currentTarget.style.background="transparent";}}>{em}</button>
                  ))}
                </div>
              </div>
            </div>
          )}
          </div>{/* end HUD + emoji picker wrapper */}

          {/* Emoji feed - shows reactions briefly — absolute so it doesn't push grid */}
          {(mode==="multi"||mode==="public")&&emojiFeed.length>0&&state==="play"&&(
            <div style={{position:"absolute",top:"100%",left:0,right:0,zIndex:40,display:"flex",flexWrap:"wrap",gap:"4px",justifyContent:"center",padding:"4px 0",pointerEvents:"none",animation:"fadeIn 0.2s ease"}}>
              {emojiFeed.map(e=>(
                <span key={e.id} style={{
                  display:"inline-flex",alignItems:"center",gap:"4px",
                  padding:"2px 8px",
                  background:`${S.dark}cc`,border:`1px solid ${S.border}`,
                  borderRadius:"16px",fontSize:"12px",
                  backdropFilter:"blur(8px)",WebkitBackdropFilter:"blur(8px)",
                  animation:e.fading?"chatFadeOut 0.8s ease forwards":"pop 0.3s ease-out"}}>
                  <span style={{fontSize:"10px",color:S.green,fontFamily:S.font,fontWeight:"600"}}>{e.nickname}</span>
                  <span style={{fontSize:"16px",lineHeight:1}}>{e.emoji}</span>
                </span>
              ))}
            </div>
          )}

          {/* Battle mode: flash when someone finds a word */}
          {gameMode==="battle"&&battleMsg&&state==="play"&&(
            <div style={{textAlign:"center",fontSize:"13px",padding:"4px 8px",marginBottom:"4px",background:battleMsg.finderId===playerId?"#00ff8822":"#ff66aa22",border:`1px solid ${battleMsg.finderId===playerId?S.green:"#ff66aa"}`,color:battleMsg.finderId===playerId?S.green:"#ff66aa",animation:"fadeIn 0.5s ease"}}>
              {battleMsg.finder}: {battleMsg.word.toUpperCase()} +{battleMsg.points}p
            </div>
          )}

          {/* Combo banner poistettu – combo-info näkyy inline sanapalkissa (rivi ~5287) */}

          {/* Exit confirmation overlay */}
          {showExitConfirm&&(
            <div style={{position:"absolute",top:0,left:0,right:0,bottom:0,background:"#000000cc",zIndex:100,display:"flex",alignItems:"center",justifyContent:"center",animation:"fadeIn 0.2s ease",borderRadius:"8px"}} onClick={()=>setShowExitConfirm(false)}>
              <div style={{background:S.dark,border:`2px solid ${S.red}`,borderRadius:S.panelRadius,padding:"24px 28px",textAlign:"center",boxShadow:`0 0 30px ${S.red}33`}} onClick={e=>e.stopPropagation()}>
                <div style={{fontSize:"16px",color:S.red,fontFamily:S.font,fontWeight:"700",marginBottom:"16px"}}>{t.exitConfirm}</div>
                <div style={{display:"flex",gap:"12px",justifyContent:"center"}}>
                  <button onClick={()=>{setShowExitConfirm(false);returnToModeSelect();}} style={{fontFamily:S.font,fontSize:"14px",color:"#fff",background:S.red,border:"none",padding:"10px 24px",cursor:"pointer",borderRadius:S.btnRadius}}>{t.exitYes}</button>
                  <button onClick={()=>setShowExitConfirm(false)} style={{fontFamily:S.font,fontSize:"14px",color:S.green,background:"transparent",border:`2px solid ${S.green}`,padding:"10px 24px",cursor:"pointer",borderRadius:S.btnRadius}}>{t.exitNo}</button>
                </div>
              </div>
            </div>
          )}


          {gameTime!==0&&(
          <div style={{height:"3px",background:S.dark,marginBottom:isHexMode?"1px":"6px",border:`1px solid ${S.border}`}}>
            <div style={{height:"100%",width:`${(time/gameTime)*100}%`,background:time<=15?S.red:time<=30?S.yellow:S.green,transition:"width 0.3s linear"}}/>
          </div>
          )}


          {/* GRID */}
          <div style={{position:"relative"}}>
            {(soloMode==="hex"||mode==="multi"||(mode==="public"&&publicHex))?(
            <div ref={gRef}
              onTouchMove={e=>{e.preventDefault();onDragMove(e.touches[0].clientX,e.touches[0].clientY);}}
              style={{padding:isLarge?"4px 0":"2px 0",background:"transparent",
                touchAction:"none",position:"relative"}}>
              {(()=>{const isLight=S.flavor==="ivory"||S.flavor==="dream";const hexGrid=mode==="multi"?currentMultiGrid:grid;return hexGrid.map((row,r)=>(
                <div key={r} style={{display:"flex",justifyContent:"center",gap:"0px",
                  marginTop:r>0?"-5.254%":"0",
                  transform:r%2===1?"translateX(calc(18.2% / 4))":"translateX(calc(-18.2% / 4))",
                  position:"relative",zIndex:hexGrid.length-r}}>
                  {row.map((letter,c)=>{
                    const s=isSel(r,c);
                    const last=sel.length>0&&sel[sel.length-1].r===r&&sel[sel.length-1].c===c;
                    const hexCols=row.length;
                    const cellIdx=r*hexCols+c;
                    const eaten=eatenCells.has(cellIdx);
                    const totalHexCells=hexGrid.length*hexCols;
                    const endAnim=eaten&&ending?ending.cellAnim(cellIdx,totalHexCells):"none";
                    const endColor=eaten&&ending?ending.cellColor(cellIdx):null;
                    const isScrambling=state==="scramble"||(state==="ending"&&scrambleGrid);
                    const settled=state==="scramble"&&(scrambleStep>cellIdx||settledCells.has(cellIdx));
                    const scrambleLetter=isScrambling&&scrambleGrid?scrambleGrid[r]?.[c]||letter:letter;
                    const displayLetter=isScrambling&&!settled&&scrambleGrid?scrambleLetter:letter;
                    const scrambleColor=isScrambling&&!settled?`hsl(${(cellIdx*37+scrambleStep*73)%360},70%,65%)`:null;
                    const hexClip="polygon(50% 0%, 100% 25%, 100% 75%, 50% 100%, 0% 75%, 0% 25%)";
                    const hexClipInner="polygon(50% 4%, 96% 27%, 96% 73%, 50% 96%, 4% 73%, 4% 27%)";
                    // Border: bright & visible in all themes; selected = aurora prismatic
                    const selIdx=s?sel.findIndex(p=>p.r===r&&p.c===c):-1;
                    const borderBg=eaten?"transparent":s?`linear-gradient(${120+selIdx*60}deg, #00ffaa, #44bbff, #aa66ff, #ff66aa, #ffaa44, #00ffaa)`:(S.cellBorder||S.border);
                    const innerInset=s?"3px":"2px";
                    const cellBg=eaten?(S.gridBg||"#111133"):s?`linear-gradient(${160+selIdx*30}deg, ${S.cell}ee 0%, ${S.cell}cc 40%, ${S.dark||S.cell}dd 100%)`:S.cellGradient?`linear-gradient(160deg, ${S.cell} 0%, ${S.dark} 100%)`:S.cell;
                    return(
                      <div key={`${r}-${c}-${dropKey}`} data-c={`${r},${c}`}
                        onMouseDown={e=>{if(state==="play"){e.preventDefault();onDragStart(r,c);}}}
                        onTouchStart={e=>{if(state==="play"){e.preventDefault();onDragStart(r,c);}}}
                        style={{
                          width:"18.2%",aspectRatio:"0.866",
                          position:"relative",
                          clipPath:hexClip,
                          cursor:state==="play"?"pointer":"default",
                          transition:"transform 0.12s ease-out",
                          transform:s?(last?"translateY(3px) scale(0.96)":"translateY(2px) scale(0.97)"):"none",
                          animation:eaten?endAnim:(isScrambling&&settled?"pop 0.2s ease":"none"),
                          zIndex:s?10:0,
                          "--ex":`${((c-Math.floor(hexCols/2))*40)}px`,"--ey":`${((r-Math.floor(grid.length/2))*40)}px`,
                        }}>
                        {/* Drop shadow — disappears when pressed */}
                        {!eaten&&!s&&<div style={{position:"absolute",inset:"-1px",top:"2px",clipPath:hexClip,
                          background:isLight?"#00000010":"#00000044",
                          filter:"blur(3px)",
                          pointerEvents:"none"}}/>}
                        {/* Base hex — soft rim for 3D depth */}
                        <div style={{position:"absolute",inset:s?"-2px":"0",clipPath:hexClip,
                          background:s?borderBg:(isLight
                            ?`linear-gradient(180deg, #ece8e2 0%, #e0dbd4 40%, #d4cec6 100%)`
                            :`linear-gradient(175deg, ${S.cellBorder||S.border} 0%, #111111 100%)`),
                          backgroundSize:s?"300% 100%":"100% 100%",
                          animation:s?`hexPrismatic 6s linear infinite, hexAuroraShift 8s ease-in-out infinite`:"none",
                          transition:"background 0.2s ease, inset 0.2s ease",
                          boxShadow:s?`0 0 12px ${S.green}88, inset 0 0 6px #ffffff22`:"none"}}/>
                        {/* Glow ring behind selected cell */}
                        {s&&!isScrambling&&<div style={{position:"absolute",inset:"-4px",clipPath:hexClip,
                          background:`radial-gradient(ellipse at 50% 50%, ${S.green}44 0%, transparent 60%)`,
                          pointerEvents:"none"}}/>}
                        {/* Pillow face — convex ceramic surface */}
                        <div style={{position:"absolute",inset:"1.5px",top:"1px",bottom:"2.5px",clipPath:hexClipInner,
                          background:eaten?(S.gridBg||"#111133"):(isLight
                            ?`radial-gradient(ellipse 80% 75% at 48% 45%, #ffffff 0%, #fefefe 25%, #faf8f5 45%, #f2eeea 65%, #e8e4de 85%, #ddd8d0 100%)`
                            :(s?cellBg:`radial-gradient(ellipse at 40% 35%, ${S.cell} 0%, ${S.cell}dd 40%, ${S.dark||S.cell}bb 80%, ${S.dark||S.cell}99 100%)`)),
                          display:"flex",alignItems:"center",justifyContent:"center",
                          fontSize:isLarge?"clamp(28px,7vw,42px)":"clamp(24px,6.5vw,36px)",
                          fontFamily:S.letterFont,fontWeight:"500",
                          textTransform:"uppercase",
                          transition:"all 0.2s ease",
                          color:eaten?endColor||"transparent":scrambleColor||(s?"#ffffff":(letterMult?letterColor(letter,lang):(S.cellText||(S.cellGradient?"#e6eef8":"#22ccaa")))),
                          textShadow:eaten?"none":s?`0 0 8px ${S.green}99, 0 1px 2px #000000cc`:(isLight?`0 1px 0 #ffffff88`:`0 1px 2px #000000aa`),
                        }}>
                          {/* Specular highlight — double-layer ceramic glaze reflection */}
                          {!eaten&&<div style={{position:"absolute",inset:0,clipPath:hexClipInner,
                            background:isLight
                              ?`radial-gradient(ellipse 50% 40% at 38% 30%, #ffffffee 0%, #ffffffaa 20%, #ffffff44 40%, transparent 65%), radial-gradient(ellipse 30% 25% at 32% 25%, #ffffff 0%, transparent 50%)`
                              :`radial-gradient(ellipse at 35% 28%, #ffffff22 0%, #ffffff11 20%, transparent 50%)`,
                            pointerEvents:"none",zIndex:0}}/>}
                          {/* Bottom-right shadow — strong edge darkening for convex ceramic shape */}
                          {!eaten&&<div style={{position:"absolute",inset:0,clipPath:hexClipInner,
                            background:isLight
                              ?`radial-gradient(ellipse 50% 40% at 68% 75%, #00000010 0%, #00000006 30%, transparent 55%)`
                              :`radial-gradient(ellipse at 70% 75%, #00000033 0%, #00000015 30%, transparent 60%)`,
                            pointerEvents:"none",zIndex:0}}/>}
                          {eaten?"":<>
                            {/* Letter */}
                            <span style={{position:"relative",zIndex:2,
                              transition:"transform 0.15s ease, text-shadow 0.15s ease, filter 0.15s ease",
                              transform:"none",
                              filter:s?`drop-shadow(0 0 3px ${S.green}88)`:"none",
                            }}>{displayLetter}</span>
                            {/* Prismatic light sweep on selected cells */}
                            {s&&!isScrambling&&<>
                              <span style={{position:"absolute",inset:0,
                                background:`linear-gradient(135deg, transparent 20%, rgba(255,255,255,0.25) 35%, rgba(68,255,170,0.12) 45%, rgba(136,102,255,0.12) 55%, rgba(255,255,255,0.2) 65%, transparent 80%)`,
                                backgroundSize:"300% 300%",
                                animation:"hexPrismatic 8s ease-in-out infinite",
                                pointerEvents:"none",zIndex:1,clipPath:hexClipInner}}/>
                              <span style={{position:"absolute",inset:0,
                                background:`radial-gradient(circle at ${30+selIdx*10}% ${25+selIdx*8}%, rgba(255,255,255,0.3) 0%, transparent 50%)`,
                                pointerEvents:"none",zIndex:1}}/>
                            </>}
                            {letterMult&&!isScrambling&&<span style={{position:"absolute",bottom:"4px",right:"6px",fontSize:"clamp(8px,2vw,11px)",fontFamily:"'Press Start 2P',monospace",color:s?"#ffffff":letterColor(letter,lang),opacity:s?0.9:0.7,lineHeight:1,zIndex:3}}>{getLetterValues(lang)[letter]||1}</span>}
                          </>}
                        </div>
                      </div>
                    );
                  })}
                </div>
              ));})()}
              {state==="ending"&&<EndingOverlay ending={ending} progress={endingProgress} gridRect={true}/>}
            </div>
            ):(<>
            <div ref={gRef} className="piilosana-grid"
              onTouchMove={e=>{e.preventDefault();onDragMove(e.touches[0].clientX,e.touches[0].clientY);}}
              style={{display:"grid",gridTemplateColumns:`repeat(${soloMode==="chess"?CHESS_SZ:SZ},1fr)`,gap:soloMode==="chess"?"2px":(S.gridGap!=="0px"?S.gridGap:isLarge?"6px":"4px"),padding:soloMode==="chess"?"4px":(isLarge?"8px":"6px"),background:S.gridBg||"#111133",
                border:`3px solid ${combo>=3&&state==="play"?S.yellow:ending?ending.color+"88":S.border}`,
                boxShadow:combo>=5?`0 0 30px ${S.purple}66`:combo>=3?`0 0 20px ${S.yellow}44`:`0 0 30px ${S.green}22`,
                touchAction:"none",
                position:"relative",
                borderRadius:S.cellRadius!=="0px"?"16px":"0px"}}>
              {(soloMode==="chess"?chessGrid:mode==="multi"?currentMultiGrid:grid).map((row,r)=>row.map((letter,c)=>{
                const isChessMode=soloMode==="chess";
                const gridSz=isChessMode?CHESS_SZ:SZ;
                const s=isChessMode?false:isSel(r,c);
                const last=isChessMode?false:(sel.length>0&&sel[sel.length-1].r===r&&sel[sel.length-1].c===c);
                const cellIdx=r*gridSz+c;
                const totalCells=gridSz*gridSz;
                const eaten=eatenCells.has(cellIdx);
                const endAnim=eaten&&ending?ending.cellAnim(cellIdx,totalCells):"none";
                const endColor=eaten&&ending?ending.cellColor(cellIdx):null;
                // Chess: checkered pattern (light/dark squares)
                const chessSquareLight=isChessMode&&(r+c)%2===0;
                const chessBottomRow=isChessMode&&r===CHESS_SZ-1;
                // Scramble: show random letter or settled real letter
                const isScrambling=state==="scramble"||(state==="ending"&&scrambleGrid);
                const settled=state==="scramble"&&scrambleStep>cellIdx;
                const scrambleLetter=isScrambling&&scrambleGrid?scrambleGrid[r]?.[c]||letter:letter;
                const displayLetter=isScrambling&&!settled&&scrambleGrid?scrambleLetter:letter;
                // Battle mode: check if other players are selecting this cell
                const BATTLE_COLORS=["#ff66aa","#66aaff","#ffaa44","#aa66ff","#66ffaa","#ff4444","#44ffff"];
                let otherSelColor=null;
                if(gameMode==="battle"&&!s){
                  const selectors=Object.entries(otherSelections);
                  for(let si=0;si<selectors.length;si++){
                    const [,{cells:oCells}]=selectors[si];
                    if(oCells&&oCells.some(oc=>oc.r===r&&oc.c===c)){
                      otherSelColor=BATTLE_COLORS[si%BATTLE_COLORS.length];
                      break;
                    }
                  }
                }
                // Tilt animation for modern theme
                const selIdx = s ? sel.findIndex(p=>p.r===r&&p.c===c) : -1;
                const selDir = selIdx > 0 ? {dr:r-sel[selIdx-1].r, dc:c-sel[selIdx-1].c} : null;
                const cellTransform = S.cellGradient && s ? (selDir ? `perspective(300px) rotateY(${selDir.dc*10}deg) rotateX(${-selDir.dr*10}deg) scale(1.06)` : `perspective(300px) scale(1.06)`) : isScrambling&&settled?"scale(1.1)":"none";
                // In tetris/battle mode, use dropKey in key to re-mount and animate
                const useDropAnim=(soloMode==="tetris"||gameMode==="battle")&&dropKey>0&&!eaten&&!s;
                // Scramble color: random hue for unsettled, green flash for just-settled
                const scrambleColor=isScrambling&&!settled?`hsl(${(cellIdx*37+scrambleStep*73)%360},70%,65%)`:null;
                // Chess mode: piece position, path, valid moves, invalid flash
                const isChess=soloMode==="chess"&&state==="play";
                const chessIsPos=isChess&&chessPos&&r===chessPos.r&&c===chessPos.c;
                const chessInPath=isChess&&chessPath.some(p=>p.r===r&&p.c===c);
                const chessIsValid=isChess&&chessValidCells.some(m=>m.r===r&&m.c===c)&&!chessInPath;
                const chessIsInvalid=isChess&&chessInvalid&&r===chessInvalid.r&&c===chessInvalid.c;
                return(
                  <div key={`${r}-${c}-${dropKey}`} data-c={`${r},${c}`}
                    onMouseDown={e=>{if(state==="play"){e.preventDefault();onDragStart(r,c);}}}
                    onTouchStart={e=>{if(state==="play"){e.preventDefault();onDragStart(r,c);}}}
                    style={{
                      width:"100%",aspectRatio:"1",display:"flex",alignItems:"center",justifyContent:"center",
                      fontSize:isChessMode?"clamp(14px,4vw,22px)":(isLarge?"clamp(34px,10vw,56px)":"clamp(28px,8vw,48px)"),fontFamily:S.letterFont,fontWeight:"700",
                      letterSpacing:S.cellGradient?"1px":"0",
                      color:eaten?endColor||"transparent":scrambleColor||(chessIsPos?"#ddaa33":chessInPath?"#ddaa33":chessIsInvalid?"#ff4444":s?(S.cellTextSel||"#0f1720"):otherSelColor||(letterMult?letterColor(letter,lang):(S.cellText||(S.cellGradient?"#e6eef8":S.green)))),
                      background:eaten?(S.gridBg||"#111133"):chessIsPos?"#ddaa3355":chessInPath?"#ddaa3330":chessIsValid?"#ddaa3320":chessIsInvalid?"#ff444433":(isChessMode&&chessPlacing&&chessBottomRow)?"#ddaa3322":isChessMode?(chessSquareLight?"#2a2a3a":"#1a1a28"):last?S.yellow:s?S.green:otherSelColor?otherSelColor+"33":(soloMode==="bomb"&&bombCell&&r===bombCell.r&&c===bombCell.c)?`linear-gradient(135deg, #ff444433 0%, #ff880033 100%)`:(soloMode==="mystery"&&mysteryCell&&r===mysteryCell.r&&c===mysteryCell.c&&!mysteryRevealed)?`linear-gradient(135deg, #aa66ff33 0%, #6644ff33 100%)`:S.cellGradient?`linear-gradient(160deg, ${S.cell} 0%, ${S.dark} 100%)`:S.cell,
                      border:chessIsPos?`2px solid #ddaa33`:chessIsValid?`2px dashed #ddaa3366`:chessIsInvalid?`2px solid #ff4444`:chessInPath?`2px solid #ddaa3355`:S.cellGradient?`1px solid ${eaten?(S.gridBg||"#111133"):s?S.green:otherSelColor||S.cellBorder}`:`2px solid ${eaten?(S.gridBg||"#111133"):s?S.green:otherSelColor||S.cellBorder}`,
                      borderRadius:S.cellRadius,
                      cursor:state==="play"?(rotateActive?"grab":"pointer"):"default",transition:isScrambling?"color 0.07s, transform 0.15s":(S.cellGradient?"all 0.15s ease, transform 0.2s cubic-bezier(0.34,1.56,0.64,1)":"all 0.1s"),transform:cellTransform,
                      boxShadow:eaten?"none":isScrambling&&settled?`0 0 12px ${S.green}66`:(s?(S.cellGradient?`0 0 16px ${S.green}55, inset 0 0 8px ${S.green}22`:`0 0 12px ${S.green}66`):otherSelColor?`0 0 8px ${otherSelColor}44`:((S.flavor==="ivory"||S.flavor==="dream")?"inset 0 1px 2px #ffffff88, inset 0 -2px 4px #00000018, 0 2px 5px #00000020, 0 1px 2px #00000015":(S.cellShadow?(S.cellShadow+", inset 0 1px 3px #ffffff12, inset 0 -1px 3px #00000030, 0 2px 4px #00000044"):("inset 0 1px 3px #ffffff12, inset 0 -1px 3px #00000030, 0 2px 4px #00000044")))),
                      textTransform:"uppercase",textShadow:isScrambling&&!settled?`0 0 8px ${scrambleColor}88`:(s||eaten?"none":((S.flavor==="ivory"||S.flavor==="dream")?`0 1px 1px #00000025`:`0 1px 2px #000000aa`)),
                      animation:chessIsInvalid?"shake 0.3s ease":eaten?endAnim:useDropAnim?`cellDrop 0.3s ${c*0.03}s ease-out`:(rotateAnim&&((rotateAnim.type==="row"&&rotateAnim.idx===r)||(rotateAnim.type==="col"&&rotateAnim.idx===c)))?`${rotateAnim.type==="row"?(rotateAnim.dir>0?"rotateRowRight":"rotateRowLeft"):(rotateAnim.dir>0?"rotateColDown":"rotateColUp")} 0.3s ease-out`:(isScrambling&&settled?"pop 0.2s ease":"none"),
                      "--ex":`${((c-2)*40)}px`,"--ey":`${((r-2)*40)}px`,
                      position:"relative",
                    }}>
                    {eaten?"":<>
                      {/* Mystery mode: show ? for hidden cell */}
                      {soloMode==="mystery"&&mysteryCell&&r===mysteryCell.r&&c===mysteryCell.c&&!mysteryRevealed&&!isScrambling?"?":displayLetter}
                      {/* Chess: glass piece overlay on current position — letter shows through */}
                      {chessIsPos&&chessPiece&&!isScrambling&&(()=>{
                        const hasAnim=chessAnimFrom&&(chessAnimFrom.r!==r||chessAnimFrom.c!==c);
                        const dx=hasAnim?`${(chessAnimFrom.c-c)*100}%`:"0";
                        const dy=hasAnim?`${(chessAnimFrom.r-r)*100}%`:"0";
                        return <span style={{position:"absolute",inset:0,display:"flex",alignItems:"center",justifyContent:"center",fontSize:"clamp(20px,6vw,34px)",lineHeight:1,zIndex:2,pointerEvents:"none",
                          color:"transparent",WebkitTextStroke:"1.5px rgba(255,255,255,0.8)",
                          filter:"drop-shadow(0 0 8px #ddaa3388) drop-shadow(0 1px 2px #000a)",
                          background:"radial-gradient(circle, rgba(221,170,51,0.15) 0%, rgba(221,170,51,0.05) 70%, transparent 100%)",
                          borderRadius:"inherit",
                          "--chess-dx":dx,"--chess-dy":dy,
                          animation:hasAnim?"chessArrive 0.25s cubic-bezier(0.22,1,0.36,1)":"none",
                        }}>{CHESS_EMOJI[chessPiece]}</span>;
                      })()}
                      {/* Chess: dot on valid moves */}
                      {chessIsValid&&!isScrambling&&<span style={{position:"absolute",width:"clamp(6px,2vw,10px)",height:"clamp(6px,2vw,10px)",borderRadius:"50%",background:"#ddaa33",opacity:0.5,zIndex:1,pointerEvents:"none"}}/>}
                      {/* Chess: placing phase — glow on bottom row cells */}
                      {isChessMode&&chessPlacing&&chessBottomRow&&!isScrambling&&<span style={{position:"absolute",inset:0,borderRadius:"inherit",boxShadow:"inset 0 0 10px #ddaa3355, 0 0 6px #ddaa3333",pointerEvents:"none"}}/>}
                      {letterMult&&!isScrambling&&<span style={{position:"absolute",bottom:"1px",right:"3px",fontSize:"clamp(9px,2.5vw,13px)",fontFamily:"'Press Start 2P',monospace",color:letterColor(letter,lang),opacity:0.7,lineHeight:1}}>{getLetterValues(lang)[letter]||1}</span>}
                      {/* Bomb indicator */}
                      {soloMode==="bomb"&&bombCell&&r===bombCell.r&&c===bombCell.c&&!isScrambling&&<span style={{position:"absolute",top:"-2px",right:"-2px",fontSize:"clamp(10px,3vw,16px)",animation:bombTimer<=5?"epicPulse 0.4s infinite":"none",lineHeight:1}}>💣</span>}
                      {/* Mystery sparkle on revealed */}
                      {soloMode==="mystery"&&mysteryCell&&r===mysteryCell.r&&c===mysteryCell.c&&mysteryRevealed&&!isScrambling&&<span style={{position:"absolute",top:"-2px",right:"-2px",fontSize:"clamp(10px,3vw,16px)",animation:"pop 0.3s ease",lineHeight:1}}>✨</span>}
                    </>}
                  </div>
                );
              }))}
            </div>
            {state==="ending"&&<EndingOverlay ending={ending} progress={endingProgress} gridRect={true}/>}
            {/* Rotate mode: visual overlay when in rotate-active state */}
            {soloMode==="rotate"&&state==="play"&&rotateActive&&(
              <div style={{position:"absolute",inset:0,pointerEvents:"none",zIndex:10,
                border:"3px solid #ff9900",borderRadius:S.cellRadius!=="0px"?"16px":"0px",
                boxShadow:"inset 0 0 20px #ff990033, 0 0 20px #ff990022"}}/>
            )}
            </>)}
          </div>

          {state==="play"&&(
            <div className="piilosana-found" style={{marginTop:isHexMode?"2px":"8px",padding:"4px 6px",border:`1px solid ${S.border}`,background:`${S.dark}ee`,maxHeight:"100px",overflowY:"auto",borderRadius:"12px",backdropFilter:"blur(12px)",WebkitBackdropFilter:"blur(12px)",boxShadow:"0 2px 12px #00000022"}}>
              <div style={{fontSize:"11px",color:S.textMuted,marginBottom:"2px"}}>{(gameMode==="battle"||(mode==="solo"&&(soloMode==="tetris"||soloMode==="rotate"||soloMode==="chess")))?`${t.found} (${found.length})`:`${t.found} (${found.length}/${valid.size}) ${valid.size>0?Math.round(found.length/valid.size*100):0}%`}</div>
              <div style={{display:"flex",flexWrap:"wrap",gap:"2px"}}>
                {found.length===0?null:
                  found.map((w,i)=>(
                    <span key={i} style={{fontSize:"14px",background:S.dark,padding:"1px 3px",border:`1px solid ${wordColor(w.length)}44`,color:wordColor(w.length),animation:i===found.length-1?"pop 0.3s ease":"none"}}>
                      {w.toUpperCase()} +{letterMult?ptsLetters(w,lang):pts(w.length)}
                    </span>
                  ))
                }
              </div>
            </div>
          )}


          {/* Unlimited mode: refresh + end buttons */}
          {state==="play"&&mode==="solo"&&gameTime===0&&(
            <div style={{display:"flex",gap:"8px",marginTop:"8px"}}>
              <button onClick={refreshGrid} style={{fontFamily:S.font,fontSize:"13px",color:"#44ddff",background:"transparent",border:"2px solid #44ddff",padding:"10px 16px",cursor:"pointer",flex:1,display:"flex",alignItems:"center",justifyContent:"center",gap:"6px"}}><Icon icon="refresh" color="#44ddff" size={2}/>{t.newLetters}</button>
              <button onClick={endUnlimited} style={{fontFamily:S.font,fontSize:"13px",color:S.red,background:"transparent",border:`2px solid ${S.red}`,padding:"10px 16px",cursor:"pointer",flex:1,display:"flex",alignItems:"center",justifyContent:"center",gap:"6px"}}><Icon icon="stop" color={S.red} size={2}/>{t.stop}</button>
            </div>
          )}
        </div>
      )}

      {/* GAME OVER */}
      {mode==="solo"&&state==="end"&&(
        <div style={{width:"100%",maxWidth:"600px",textAlign:"center",animation:"fadeIn 1s ease",position:"relative"}}>
          {confettiOn&&<ConfettiCelebration isWinner={true}/>}
          <div style={{position:"relative",zIndex:1,border:`1px solid ${ending?.color||S.yellow}44`,padding:"24px",marginBottom:"16px",boxShadow:`0 4px 24px ${ending?.color||S.yellow}22, 0 8px 32px #00000022`,background:`${S.dark}f0`,borderRadius:"16px",backdropFilter:"blur(12px)",WebkitBackdropFilter:"blur(12px)"}}>
            {dailyMode?<><div style={{fontSize:"15px",color:S.yellow||"#ffcc00",marginBottom:"4px",fontWeight:"700"}}>{t.daily} {dateLabel(dailyDate,lang).short}</div>
            {dailyTheme&&<div style={{fontSize:"12px",color:S.textMuted,marginBottom:"6px",fontStyle:"italic"}}>{lang==="en"?"Theme":lang==="sv"?"Tema":"Teema"}: {lang==="en"?dailyTheme.nameEn||dailyTheme.name:lang==="sv"?dailyTheme.nameSv||dailyTheme.name:dailyTheme.name}</div>}</>
            :<div style={{fontSize:"13px",color:ending?.color||S.yellow,marginBottom:"4px"}}>{ending?.emoji} {ending?.desc||"Peli päättyi!"}</div>}
            {!dailyMode&&(()=>{const m=gameTime===0?(lang==="en"?"unlimited":lang==="sv"?"obegränsad":"rajaton"):gameTime===402?"6,7 min":`${Math.round(gameTime/60)} min`;return(<div style={{fontSize:"11px",color:S.textMuted,marginBottom:"6px",letterSpacing:"1px",fontWeight:"600",opacity:0.75}}>{m}</div>);})()}
            <div style={{fontSize:"13px",color:S.textMuted,marginBottom:"10px"}}>{t.score}</div>
            <div style={{fontSize:"36px",color:S.green,marginBottom:"4px",animation:"pop 0.3s ease",fontWeight:"700",letterSpacing:"2px"}}>{score}<span style={{fontSize:"16px",color:S.textMuted,fontWeight:"400"}}>p</span>{(soloMode==="normal"&&gameTime!==0)?<span style={{fontSize:"16px",color:S.textMuted,fontWeight:"400"}}> / {totalPossible}p</span>:null}</div>
            {(soloMode!=="normal"||gameTime===0)?<div style={{fontSize:"13px",color:S.textMuted,marginTop:"6px"}}>{found.length} {t.words}</div>:<>
            <div style={{fontSize:"13px",color:S.textSoft,marginTop:"6px"}}>{found.length} / {valid.size} {t.words} ({valid.size>0?Math.round(found.length/valid.size*100):0}%)</div>
            </>}

            {/* Hall of Fame submit — skip for daily mode (auto-saved) */}
            {!dailyMode&&gameTime!==0&&score>0&&!hofSubmitted&&(
              <div style={{marginTop:"16px",padding:"14px",border:`1px solid ${S.yellow}33`,background:`${S.yellow}08`,borderRadius:"12px"}}>
                {soloNickname.trim()?(
                  <button onClick={async()=>{
                    await submitToHallOfFame({nickname:soloNickname.trim(),score,wordsFound:found.length,
                      wordsTotal:valid.size,gameMode:soloMode,gameTime,lang});
                    setHofSubmitted(true);
                  }} style={{fontFamily:S.font,fontSize:"13px",color:S.bg,background:S.yellow,border:"none",padding:"8px 16px",cursor:"pointer"}}>
                    {t.saveAs} {soloNickname.trim()}
                  </button>
                ):(
                  <>
                    <div style={{fontSize:"13px",color:S.yellow,marginBottom:"6px"}}>{t.saveToHof}</div>
                    <div style={{display:"flex",gap:"6px",justifyContent:"center",alignItems:"center"}}>
                      <input type="text" maxLength="12" value={soloNickname} onChange={e=>{setSoloNickname(e.target.value.toUpperCase());localStorage.setItem("piilosana_nick",e.target.value.toUpperCase());}}
                        placeholder={t.nickname} style={{fontFamily:S.font,fontSize:"13px",color:S.green,background:S.dark,
                        border:`2px solid ${S.green}`,padding:"8px",width:"140px",textAlign:"center",outline:"none"}}/>
                      <button onClick={async()=>{
                        if(!soloNickname.trim())return;
                        await submitToHallOfFame({nickname:soloNickname.trim(),score,wordsFound:found.length,
                          wordsTotal:valid.size,gameMode:soloMode,gameTime,lang});
                        setHofSubmitted(true);
                      }} disabled={!soloNickname.trim()}
                        style={{fontFamily:S.font,fontSize:"13px",color:soloNickname.trim()?S.bg:S.textMuted,
                        background:soloNickname.trim()?S.yellow:S.border,border:"none",padding:"8px 12px",cursor:soloNickname.trim()?"pointer":"default"}}>
                        {t.save}
                      </button>
                    </div>
                  </>
                )}
              </div>
            )}
            {!dailyMode&&hofSubmitted&&<div style={{fontSize:"13px",color:S.green,marginTop:"8px"}}>{t.saved}</div>}

            {/* Share result */}
            <button onClick={async()=>{
              const text=t.shareText.replace("{words}",found.length).replace("{score}",score)+"\nhttps://piilosana.up.railway.app";
              if(navigator.share){try{await navigator.share({text});return;}catch{}}
              try{await navigator.clipboard.writeText(text);addPopup(t.shareCopied,S.green);}catch{}
            }} style={{fontFamily:S.font,fontSize:"13px",color:"#44ddff",border:`1px solid #44ddff66`,background:"#44ddff08",
              padding:"10px 16px",cursor:"pointer",marginTop:"12px",width:"280px",borderRadius:"10px",transition:"all 0.15s"}}>
              {t.share}
            </button>

            {dailyMode&&(()=>{
              const dr=dailyResult||getDailyResultForDate(dailyDate,lang);
              const dl=dateLabel(dailyDate,lang);
              if(!dr)return null;
              return(
                <DailyEndResult
                  S={S}
                  t={t}
                  lang={lang}
                  dateStr={dailyDate}
                  dateLabel={dl}
                  result={dr}
                  onShare={shareDailyResult}
                  shareMsg={dailyShareMsg}
                  themeFound={dailyThemeFound.length}
                  themeBonusGiven={dailyThemeBonusGiven}
                  themeBonus={DAILY_THEME_BONUS}
                  themeThreshold={DAILY_THEME_THRESHOLD}
                  themeName={dailyTheme?(lang==="en"?dailyTheme.nameEn||dailyTheme.name:lang==="sv"?dailyTheme.nameSv||dailyTheme.name:dailyTheme.name):null}
                />
              );
            })()}

            <div style={{display:"flex",flexDirection:"column",gap:"8px",alignItems:"center",marginTop:"10px"}}>
              <button onClick={returnToModeSelect} style={{fontFamily:S.font,fontSize:"16px",color:S.bg,background:S.green,border:"none",padding:"12px 20px",cursor:"pointer",width:"280px",borderRadius:"12px",boxShadow:`0 4px 12px ${S.green}33`,transition:"all 0.15s",fontWeight:"600"}}>{t.backToMenu}</button>
              <button onClick={switchToMulti} style={{fontFamily:S.font,fontSize:"16px",color:S.bg,background:S.yellow,border:"none",padding:"12px 20px",cursor:"pointer",width:"280px",borderRadius:"12px",boxShadow:`0 4px 12px ${S.yellow}33`,transition:"all 0.15s",fontWeight:"600"}}>{t.joinMulti}</button>
            </div>
          </div>

          {found.length>0&&(
            <div style={{padding:"12px",border:`1px solid ${S.border}`,background:`${S.dark}ee`,marginBottom:"12px",textAlign:"left",animation:"fadeIn 0.8s ease",borderRadius:"12px",backdropFilter:"blur(8px)",WebkitBackdropFilter:"blur(8px)"}}>
              <div style={{fontSize:"14px",color:S.green,marginBottom:"8px",fontWeight:"600",letterSpacing:"0.5px"}}>{t.foundOf} ({found.length})</div>
              <div style={{display:"flex",flexWrap:"wrap",gap:"3px"}}>
                {[...found].sort((a,b)=>b.length-a.length).map((w,i)=>{
                  const isTheme=dailyMode&&dailyTheme&&isThemeWord(w,dailyTheme);
                  return(
                  <span key={i} onClick={e=>showDef(w,e)} style={{fontSize:"18px",background:isTheme?`${S.yellow||"#ffcc00"}22`:S.dark,padding:"2px 4px",border:`1px solid ${isTheme?(S.yellow||"#ffcc00"):wordColor(w.length)}44`,color:isTheme?(S.yellow||"#ffcc00"):wordColor(w.length),cursor:DEFS&&DEFS[w.toLowerCase()]?"pointer":"default",textDecoration:DEFS&&DEFS[w.toLowerCase()]?"underline dotted":"none",textUnderlineOffset:"3px"}}>{isTheme?"🎯 ":""}{w.toUpperCase()}</span>
                  );})}
              </div>
            </div>
          )}

          {soloMode==="normal"&&gameTime!==0&&missed.length>0&&(
            <div style={{padding:"12px",border:`1px solid ${S.border}`,background:`${S.dark}ee`,textAlign:"left",maxHeight:"180px",overflowY:"auto",animation:"fadeIn 1s ease",borderRadius:"12px",backdropFilter:"blur(8px)",WebkitBackdropFilter:"blur(8px)"}}>
              <div style={{fontSize:"14px",color:"#ff6666",marginBottom:"8px",fontWeight:"600",letterSpacing:"0.5px"}}>{t.missed} ({missed.length})</div>
              <div style={{display:"flex",flexWrap:"wrap",gap:"3px"}}>
                {missed.map((w,i)=>(
                  <span key={i} onClick={e=>showDef(w,e)} style={{fontSize:"14px",background:S.dark,padding:"2px 4px",border:"1px solid #ff444444",color:"#ff6666",cursor:DEFS&&DEFS[w.toLowerCase()]?"pointer":"default",textDecoration:DEFS&&DEFS[w.toLowerCase()]?"underline dotted":"none",textUnderlineOffset:"3px"}}>{w.toUpperCase()}</span>
                ))}
              </div>
              {lang==="fi"&&<div style={{fontSize:"12px",color:S.textMuted,marginTop:"8px",fontStyle:"italic"}}>{t.missedLong||"Laudalta löytyi myös pidempiä sanoja"}</div>}
            </div>
          )}

          {/* Hall of Fame */}
          <HallOfFame gameMode={soloMode} gameTime={gameTime} currentScore={hofSubmitted?score:null} S={S} lang={lang}/>
        </div>
      )}

      {/* Ad banner placeholder */}
      <div style={{width:"100%",maxWidth:"600px",minHeight:"60px",marginTop:"16px",flexShrink:0}}/>


      {/* Universal hamburger menu overlay */}
      {showHamburger&&(
        <HamburgerMenu
          S={S}
          t={t}
          lang={lang}
          Icon={Icon}
          sound={soundTheme==="modern"}
          music={musicOn}
          musicTrack={musicTrack}
          musicTracks={musicTracks}
          theme={themeId}
          themes={THEMES}
          size={uiSize}
          confetti={confettiOn}
          muteEmojis={muteEmojis}
          inMultiplayer={mode==="multi"||mode==="public"}
          inActiveGame={state==="play"||state==="ending"||state==="scramble"}
          hasMode={mode!==null}
          onSoundToggle={()=>{
            const next=soundTheme==="modern"?"off":"modern";
            setSoundTheme(next);
            localStorage.setItem("piilosana_sound",next);
          }}
          onMusicToggle={()=>{
            const next=!musicOn;
            setMusicOn(next);
            localStorage.setItem("piilosana_music",next?"on":"off");
            if(!next&&music)music.stop();
          }}
          onMusicTrackChange={(i)=>{
            setMusicTrack(i);
            localStorage.setItem("piilosana_music_track",String(i));
          }}
          onThemeChange={(id)=>{
            setThemeId(id);
            localStorage.setItem("piilosana_theme",id);
            if(typeof syncSettings==="function")syncSettings({theme:id});
          }}
          onSizeChange={(id)=>{
            setUiSize(id);
            localStorage.setItem("piilosana_size",id);
            if(typeof syncSettings==="function")syncSettings({size:id});
          }}
          onConfettiToggle={()=>{
            const v=!confettiOn;
            setConfettiOn(v);
            localStorage.setItem("piilosana_confetti",v?"on":"off");
            if(typeof syncSettings==="function")syncSettings({confetti:v});
          }}
          onMuteEmojisToggle={()=>{
            const next=!muteEmojis;
            setMuteEmojis(next);
            localStorage.setItem("piilosana_mute_emoji",next?"on":"off");
          }}
          onShare={()=>{setShowHamburger(false);setShowSharePopup(true);}}
          onExit={()=>{
            setShowHamburger(false);
            if(mode==="solo"&&(state==="play"||state==="ending"||state==="scramble")){
              setShowExitConfirm(true);
            }else{
              returnToModeSelect();
            }
          }}
          onClose={()=>setShowHamburger(false)}
        />
      )}

      {/* Ivory Light — warm golden shimmer */}
      {themeId==="light"&&(
        <div style={{position:"fixed",top:0,left:0,width:"100%",height:"100%",pointerEvents:"none",zIndex:0,overflow:"hidden"}}>
          <div style={{position:"absolute",top:"-20%",right:"-10%",width:"60%",height:"60%",
            background:"radial-gradient(ellipse at center,rgba(184,134,11,0.06) 0%,transparent 70%)",
            animation:"floatUnicorn 12s ease-in-out infinite"}}/>
          <div style={{position:"absolute",bottom:"-10%",left:"-10%",width:"50%",height:"50%",
            background:"radial-gradient(ellipse at center,rgba(45,106,79,0.04) 0%,transparent 70%)",
            animation:"floatUnicorn 10s ease-in-out infinite 3s"}}/>
        </div>
      )}

      {/* AdSense Banner — bottom of page, outside game area */}
      <AdBanner/>

      {/* Dark Velvet — subtle purple mist */}
      {themeId==="dark"&&(
        <div style={{position:"fixed",top:0,left:0,width:"100%",height:"100%",pointerEvents:"none",zIndex:0,overflow:"hidden"}}>
          <div style={{position:"absolute",top:"50%",left:"50%",transform:"translate(-50%,-50%)",
            width:"130%",height:"130%",
            background:"radial-gradient(ellipse at 30% 40%,rgba(179,157,219,0.05) 0%,transparent 55%),radial-gradient(ellipse at 70% 60%,rgba(206,147,216,0.04) 0%,transparent 50%)",
            animation:"electricPulse 8s ease-in-out infinite"}}/>
        </div>
      )}

      {/* Pink Blush — floating hearts & sparkles */}
      {themeId==="pink"&&(
        <div style={{position:"fixed",top:0,left:0,width:"100%",height:"100%",pointerEvents:"none",zIndex:0,overflow:"hidden"}}>
          <div style={{position:"absolute",top:"10%",left:"5%",fontSize:"28px",opacity:0.08,animation:"floatUnicorn 8s ease-in-out infinite"}}>💖</div>
          <div style={{position:"absolute",top:"30%",right:"8%",fontSize:"22px",opacity:0.06,animation:"floatUnicorn 10s ease-in-out infinite 2s"}}>🌸</div>
          <div style={{position:"absolute",bottom:"20%",left:"10%",fontSize:"24px",opacity:0.06,animation:"floatUnicorn 9s ease-in-out infinite 4s"}}>✨</div>
          <div style={{position:"absolute",top:"60%",right:"5%",fontSize:"22px",opacity:0.05,animation:"floatUnicorn 11s ease-in-out infinite 1s"}}>💗</div>
        </div>
      )}

      {/* Electric Blue – pulsing cyan glow */}
      {themeId==="electric"&&(
        <div style={{position:"fixed",top:0,left:0,width:"100%",height:"100%",pointerEvents:"none",zIndex:0,overflow:"hidden"}}>
          <div style={{position:"absolute",top:"30%",left:"50%",transform:"translate(-50%,-50%)",width:"60%",height:"40%",
            background:"radial-gradient(ellipse at center,rgba(0,229,255,0.06) 0%,transparent 70%)",
            animation:"electricPulse 3s ease-in-out infinite"}}/>
          <div style={{position:"absolute",top:"20%",left:"10%",width:"40%",height:"40%",
            background:"radial-gradient(ellipse at center,rgba(118,255,3,0.03) 0%,transparent 60%)",
            animation:"electricPulse 5s ease-in-out infinite 1.5s"}}/>
        </div>
      )}

      {/* Retro – scanlines + neon glow */}
      {themeId==="retro"&&(
        <div style={{position:"fixed",top:0,left:0,width:"100%",height:"100%",pointerEvents:"none",zIndex:0,overflow:"hidden"}}>
          <div style={{position:"absolute",top:0,left:0,width:"100%",height:"100%",
            background:"repeating-linear-gradient(0deg,transparent,transparent 3px,rgba(0,255,136,0.015) 3px,rgba(0,255,136,0.015) 4px)"}}/>
          <div style={{position:"absolute",top:"50%",left:"50%",transform:"translate(-50%,-50%)",
            width:"100%",height:"100%",
            background:"radial-gradient(ellipse at center,rgba(0,255,136,0.05) 0%,transparent 65%)"}}/>
        </div>
      )}
    </div>
  );
}
