const dictionary = require('../../services/dictionary');
const store = require('../../utils/store');
const ui = require('../../utils/ui');
const media = require('../../services/media');
const sentences = require('../../services/sentences');
const study = require('../../services/study');
const codec = require('../../vendor/codec');
const learning = require('../../utils/oxford-learning');
const {Pronunciation,voiceLabel}=require('../../services/pronunciation');
const POS = { n: '名词', v: '动词', a: '形容词', r: '副词' };
function entryView(result){
  const oxford=result.oxford||{},hasOxford=!!(oxford.blocks||[]).length;
  return {word:result.word,phonetic:result.phonetic||'',phonetics:result.phonetics||oxford.phonetics||{},zh:result.zh||'',en:result.en||'',forms:result.forms||[],learningTags:learning.badges(oxford.learning),matchedFrom:result.referenceLabel?'':result.matchedFrom||'',sourceLabel:result.source==='offline-pack'?'牛津十版 · 全量离线':result.source==='cache'?'已缓存 · 可离线重看':result.source==='builtin'?'内置离线词条':'全量词库',hasOxford,hasContents:hasOxford&&(!!(oxford.contents||[]).length||!oxford.navVersion),hasTeaching:!!result.teaching,hasBase:!!(result.zh||result.en),hasExamples:!!(oxford.examples||[]).length,hasSenses:!!(result.senses||[]).length};
}
Page({
  data: { loading: true, error: '', matches: [], resultKind:'', suggestionKind:'', matchPage:0, matchNextCursor:null, matchLoading:false, matchError:'', matchSource:'', supplementLoading:false,supplementError:'',supplementState:'',supplementNote:'',voiceStatus:'',speakingVariant:'',speakingExample:-1,exampleStatusIndex:-1,exampleStatus:'', entry: null, favorite: false, groupPicker:false, groupingMeaning:'', bookNames:'', note: '', noteStatus: '', source: '', oxfordBlocks: [], senses: [], examples:[], related:[], referenceRows:[], relatedTotal:0, relatedPage:0, relatedPages:1, contentsOpen:false,contentsLoading:false,contentsPage:0,contentsPages:1,contentsTotal:0,contentsRows:[],localJumpRows:[],wordListsOpen:false,wordListsLoading:false,wordListsError:'',wordListRows:[],wordListPage:0,wordListPages:1,wordListTotal:0,focusLabel:'',focusError:'',referenceLoading:false, page: 0, totalPages: 1, theme: 'light', fontSize: 16 },
  onLoad(options) { let query,anchor;try{query=decodeURIComponent(options.q||'');}catch(_){query=options.q||'';}try{anchor=decodeURIComponent(options.anchor||'');}catch(_){anchor=options.anchor||'';}this._query=query;this.load(query,{anchor,reference:options.ref==='1',label:ui.decode(options.label).slice(0,256)}); },
  onShow() { ui.apply(this); if (this._entry) this.refreshFavorite(); },
  async load(word,options={}) {
    this._voiceGeneration=(this._voiceGeneration||0)+1;if(this._pronunciation)this._pronunciation.cancel();
    const generation = (this._generation || 0) + 1; this._generation = generation; this._query = word;
    this._entry = null; this._matchCursors=[0]; this._matchTarget=null;this._focus=null;this._requestedAnchor=String(options.anchor||'').slice(0,1024);
    this.setData({ loading: true, error: '', matches: [], entry: null, resultKind:'', suggestionKind:'', matchPage:0, matchNextCursor:null, matchLoading:false, matchError:'', matchSource:'',supplementLoading:false,supplementError:'',supplementState:'',supplementNote:'',voiceStatus:'',speakingVariant:'',speakingExample:-1,exampleStatusIndex:-1,exampleStatus:'',contentsOpen:false,contentsLoading:false,contentsPage:0,contentsRows:[],localJumpRows:[],wordListsOpen:false,wordListsLoading:false,wordListsError:'',wordListRows:[],wordListPage:0,wordListPages:1,wordListTotal:0,focusLabel:'',focusError:'',referenceLoading:false });
    try {
      const result = options.entry||await dictionary.lookup(word); if (this._generation !== generation) return;
      if (result.kind !== 'entry') {
        if(result.kind==='matches'&&(result.matches||[]).length)try{store.visit(word,'找到 '+result.matches.length+(Number.isInteger(result.nextCursor)?'+':'')+' 个相关词条');}catch(error){ui.error(error);}
        this._entry = null;
        this.setData({ loading:false, matches:result.matches||result.suggestions||[], resultKind:result.kind,suggestionKind:result.suggestionKind||'', partial:!!result.partial, matchSource:result.source||'', matchNextCursor:Number.isInteger(result.nextCursor)?result.nextCursor:null, error:result.hint||(result.kind==='matches'?(result.matches.length?'':'没有匹配的中文释义，请换个关键词再试。'):((result.suggestions||[]).length?'未找到这个拼写，选择下面的词条继续查词。':'本地词库暂未匹配到，可调整拼写或查询原形。')),matchQuery:word });return;
      }
      this._entry=options.reference?Object.assign({},result,{referenceLabel:options.label||result.word}):result;
      const meaning = result.brief || result.zh || (result.teaching || {}).title || '';
      try { store.visit(result.word, meaning); } catch (error) { ui.error(error); }
      const view=entryView(this._entry);
      this.setData({loading:false,entry:view,teaching:result.teaching||null,source:view.hasOxford?'oxford':view.hasTeaching?'teaching':view.hasSenses?'wordnet':'base',supplementState:result.supplementState||'',supplementNote:result.supplementState==='cache'?'补充词典已缓存，可离线查阅':'简释 · 英语分义 · 用法说明'});
      this.refreshFavorite();if(options.draft&&store.key(options.draft.word)===store.key(result.word))this.setData({note:options.draft.note,noteStatus:'尚未保存'});
      this.contentPage(0); this.relatedPage(0);this.contentsPage(0);this.wordListsPage(0);if(this._requestedAnchor)this.focusAnchor(this._requestedAnchor,options.label);wx.setNavigationBarTitle({ title: result.word });
      if(options.openContents)this.setData({contentsOpen:true},()=>wx.pageScrollTo({selector:'#entry-contents',duration:180}));
      if(options.openWordLists)this.setData({wordListsOpen:true},()=>wx.pageScrollTo({selector:'#entry-wordlists',duration:180}));
    } catch (error) { if (this._generation === generation) this.setData({ loading: false, error: error.message }); }
  },
  async onMoreDictionaries(){
    if(!this._entry||this.data.supplementLoading)return;
    const generation=this._generation;this.setData({supplementLoading:true,supplementError:''});
    try{
      const extra=await dictionary.supplement(this._entry.word,{refresh:true});
      if(this._generation!==generation)return;
      this._entry=dictionary.mergeSupplement(this._entry,extra);
      this.setData({entry:entryView(this._entry),teaching:this._entry.teaching||null,supplementState:this._entry.supplementState||'',supplementError:extra.refreshError||'',supplementNote:extra.found?(extra.source==='cache'?'补充词典已缓存，可离线查阅':'补充词典已读取'):extra.available?'补充词典暂未收录此词':'该服务尚未安装补充词库'});
      this.contentPage(this.data.page);this.relatedPage(this.data.relatedPage);
    }catch(error){if(this._generation===generation)this.setData({supplementError:error.message});}
    finally{if(this._generation===generation)this.setData({supplementLoading:false});}
  },
  refreshFavorite() { try { const item = store.favorite(this._entry.word); this.setData({ favorite: !!item,bookNames:item?store.groups().filter(group=>item.groups.includes(group.id)).map(group=>group.name).join(' / '):'',note: item ? item.note : '', noteStatus: item && item.note ? '已保存到本机' : '' }); } catch (error) { ui.error(error); } },
  contentPage(index,afterUpdate) {
    const entry = this._entry; if (!entry) return;
    const oxford = this.data.source === 'oxford',examples=this.data.source==='examples'; const rows = oxford ? (this._focus?this._focus.blocks:entry.oxford.blocks) : examples?((entry.oxford||{}).examples||[]):(entry.senses || []); const size = oxford ? 4 : 8;
    const totalPages = Math.max(1, Math.ceil(rows.length / size)); index = Math.min(Math.max(0, index), totalPages - 1);
    this.setData({ page: index, totalPages, totalItems: rows.length, oxfordBlocks: oxford ? rows.slice(index * size, (index + 1) * size) : [],examples:examples?rows.slice(index*size,(index+1)*size):[],senses: oxford||examples ? [] : rows.slice(index * size, (index + 1) * size).map(row => Object.assign({}, row, { posLabel: POS[row.pos] || row.pos })) },afterUpdate);
  },
  onSource(event) { const source=ui.dataset(event,'source');this.stopExampleVoice();this.setData({source});this.contentPage(source==='oxford'&&this._focus?Math.floor(this._focus.index/4):0); },
  relatedPage(index){
    const entry=this._entry||{},rows=((entry.oxford||{}).references||[]).slice(),words=new Set(rows.map(row=>row.word));
    for(const word of entry.related||[])if(!words.has(word)){rows.push({word,anchor:'',label:word});words.add(word);}
    this._references=rows;const pages=Math.max(1,Math.ceil(rows.length/24));index=Math.min(Math.max(0,index),pages-1);
    const selected=rows.slice(index*24,(index+1)*24);this.setData({related:selected.map(row=>row.word),referenceRows:selected.map((row,i)=>Object.assign({},row,{index:index*24+i,learningLabel:learning.badges(row.learning).join(' · ')})),relatedPage:index,relatedPages:pages,relatedTotal:rows.length});
  },
  contentsPage(index){
    const nav=(this._entry||{}).oxford||{},rows=nav.contents||[],pages=Math.max(1,Math.ceil(rows.length/24));index=Math.min(Math.max(0,index),pages-1);
    const links=nav.localLinks||[],anchors=nav.anchors||[];
    const localJumpRows=links.map((row,index)=>{
      const target=anchors.find(item=>item.id===row.anchor&&item.document===row.document)||anchors.find(item=>item.id===row.anchor);if(!target)return null;
      const section=rows.filter(item=>item.document===target.document&&item.kind==='词性'&&item.position<=target.position).slice(-1)[0],pos=section&&section.label.split(' · ').slice(1).join(' · ');
      return Object.assign({},row,{index,displayLabel:links.filter(item=>item.label===row.label).length>1&&pos?row.label+' · '+pos:row.label});
    }).filter(Boolean);
    this.setData({contentsPage:index,contentsPages:pages,contentsTotal:rows.length,contentsRows:rows.slice(index*24,(index+1)*24).map((row,i)=>Object.assign({},row,{index:index*24+i})),localJumpRows});
  },
  async onContents(){
    if(this.data.contentsLoading||this.data.wordListsLoading||!this._entry)return;
    if(!(this._entry.oxford||{}).navVersion){
      const generation=this._generation,word=this._entry.word;this.setData({contentsLoading:true,focusError:''});
      try{const result=await dictionary.lookup(word,{refresh:true});if(this._generation!==generation)return;
        if(result.kind!=='entry'||!result.oxford||!result.oxford.navVersion)throw new Error('旧缓存尚未包含目录，请连接新版词库服务后重试。');
        const draft=this.data.noteStatus==='尚未保存'?{word,note:this.data.note}:null;
        await this.load(word,{entry:result,draft,openContents:true});
      }catch(error){if(this._generation===generation)this.setData({focusError:error.message});}
      finally{if(this._generation===generation)this.setData({contentsLoading:false});}
      return;
    }
    this.contentsPage(this.data.contentsPage||0);this.setData({contentsOpen:!this.data.contentsOpen},()=>{if(this.data.contentsOpen)wx.pageScrollTo({selector:'#entry-contents',duration:180});});
  },
  onContentsPrev(){this.contentsPage(this.data.contentsPage-1);wx.pageScrollTo({selector:'#entry-contents',duration:180});},
  onContentsNext(){this.contentsPage(this.data.contentsPage+1);wx.pageScrollTo({selector:'#entry-contents',duration:180});},
  onContentsItem(event){const item=(((this._entry||{}).oxford||{}).contents||[])[Number(ui.dataset(event,'index'))];if(item)this.focusTarget(item,item.label);},
  onLocalJump(event){const item=(((this._entry||{}).oxford||{}).localLinks||[])[Number(ui.dataset(event,'index'))];if(item)this.focusAnchor(item.anchor,item.label,item.document);},
  focusAnchor(anchor,label,document){
    const rows=(((this._entry||{}).oxford||{}).anchors||[]),target=rows.find(row=>row.id===anchor&&(document===undefined||row.document===document))||rows.find(row=>row.id===anchor);
    if(target)this.focusTarget(target,label||'所选义项');else this.setData({focusError:'已打开词条；原词库没有提供这个具体定位。'});
  },
  focusTarget(target,label){
    try{this._focus=codec.focusOxford(this._entry.oxford,target);this._requestedAnchor=target.id||'';this.setData({source:'oxford',contentsOpen:false,focusLabel:label||'所选义项',focusError:''});this.contentPage(Math.floor(this._focus.index/4),()=>wx.pageScrollTo({selector:'#oxford-'+this._focus.id,duration:180}));}
    catch(error){this.setData({focusError:error.message});}
  },
  onClearFocus(){const index=this._focus?this._focus.originalIndex:0;this._focus=null;this._requestedAnchor='';this.setData({focusLabel:'',focusError:'',source:'oxford'});this.contentPage(Math.floor(index/4));},
  async onReference(event){
    const item=(this._references||[])[Number(ui.dataset(event,'index'))];if(!item||this.data.referenceLoading)return;
    const draft=this.data.noteStatus==='尚未保存'?{word:this._entry.word,note:this.data.note}:null;
    if(item.anchor&&store.key(item.word)===store.key(this._entry.word)&&((this._entry.oxford||{}).anchors||[]).some(row=>row.id===item.anchor))this.focusAnchor(item.anchor,item.label);
    else return this.load(item.word,{anchor:item.anchor,label:item.label,reference:true,draft});
  },
  onRelatedPrev(){this.relatedPage(this.data.relatedPage-1);wx.pageScrollTo({selector:'#related-start',duration:180});},
  onRelatedNext(){this.relatedPage(this.data.relatedPage+1);wx.pageScrollTo({selector:'#related-start',duration:180});},
  wordListsPage(index){
    const rows=(((this._entry||{}).oxford||{}).wordListLinks||[]),pages=Math.max(1,Math.ceil(rows.length/12));index=Math.min(Math.max(0,index),pages-1);
    this.setData({wordListPage:index,wordListPages:pages,wordListTotal:rows.length,wordListRows:rows.slice(index*12,(index+1)*12).map((row,i)=>Object.assign({},row,{index:index*12+i}))});
  },
  async onWordLists(){
    if(this.data.wordListsLoading||this.data.contentsLoading||!this._entry)return;
    if(!(this._entry.oxford||{}).wordListVersion){
      const generation=this._generation,word=this._entry.word;this.setData({wordListsLoading:true,wordListsError:''});
      try{const result=await dictionary.lookup(this._query||word,{refresh:true});if(this._generation!==generation)return;
        if(result.kind!=='entry'||!result.oxford||!result.oxford.wordListVersion)throw new Error('当前缓存尚未包含词表链接，请连接新版词库服务后重试。');
        const draft=this.data.noteStatus==='尚未保存'?{word,note:this.data.note}:null;
        await this.load(this._query||word,{entry:result,draft,openWordLists:true,anchor:this._requestedAnchor,reference:!!this._entry.referenceLabel,label:this._entry.referenceLabel||''});
      }catch(error){if(this._generation===generation)this.setData({wordListsOpen:true,wordListsError:error.message});}
      finally{if(this._generation===generation)this.setData({wordListsLoading:false});}
      return;
    }
    this.wordListsPage(this.data.wordListPage);this.setData({wordListsOpen:!this.data.wordListsOpen,wordListsError:''},()=>{if(this.data.wordListsOpen)wx.pageScrollTo({selector:'#entry-wordlists',duration:180});});
  },
  onWordListLink(event){const row=((((this._entry||{}).oxford||{}).wordListLinks)||[])[Number(ui.dataset(event,'index'))];if(row)wx.navigateTo({url:'/pages/wordlist/index?oxford='+encodeURIComponent(row.id),fail:()=>ui.error(new Error('暂时无法打开词表，请返回一层后重试'))});},
  onAllWordLists(){wx.navigateTo({url:'/pages/wordlist/index?source=oxford'});},
  onDictionaryMedia(){if(this._entry){media.stopAudio();wx.navigateTo({url:'/pages/dictionary-media/index?q='+encodeURIComponent(this._query||this._entry.word),fail:()=>ui.error(new Error('暂时无法打开媒体页，请返回一层后重试'))});}},
  onWordListsPrev(){this.wordListsPage(this.data.wordListPage-1);wx.pageScrollTo({selector:'#entry-wordlists',duration:180});},
  onWordListsNext(){this.wordListsPage(this.data.wordListPage+1);wx.pageScrollTo({selector:'#entry-wordlists',duration:180});},
  onPrev() { this.stopExampleVoice();this.contentPage(this.data.page - 1); wx.pageScrollTo({ selector: '#content-start', duration: 180 }); },
  onNext() { this.stopExampleVoice();this.contentPage(this.data.page + 1); wx.pageScrollTo({ selector: '#content-start', duration: 180 }); },
  onWord(event) { const word = ui.dataset(event); if (!word||this.data.matchLoading)return;if(!this._entry&&this.data.matches.length){wx.navigateTo({url:'/pages/entry/index?q='+encodeURIComponent(word),fail:()=>ui.error(new Error('暂时无法打开词条，请返回一层后重试'))});return;}return this.load(word).then(()=>wx.pageScrollTo({scrollTop:0,duration:0})); },
  async matchPage(index,cursor){
    if(this.data.matchLoading||!Number.isInteger(cursor)||index<0)return;
    const generation=this._generation;this._matchTarget={index,cursor};this.setData({matchLoading:true,matchError:''});
    try{
      const result=await dictionary.matchPage(this.data.matchQuery,cursor,this.data.matchSource);
      if(this._generation!==generation)return;
      if(result.kind!=='matches'||!Array.isArray(result.matches))throw new Error('服务返回的查询页无效，请更新服务后重试');
      this._matchCursors[index]=cursor;
      this.setData({matches:result.matches,matchPage:index,matchNextCursor:Number.isInteger(result.nextCursor)?result.nextCursor:null});
      wx.pageScrollTo({selector:'#matches-start',duration:180});
    }catch(error){if(this._generation===generation)this.setData({matchError:error.message});}
    finally{if(this._generation===generation)this.setData({matchLoading:false});}
  },
  onMatchPrev(){return this.matchPage(this.data.matchPage-1,(this._matchCursors||[])[this.data.matchPage-1]);},
  onMatchNext(){return this.matchPage(this.data.matchPage+1,this.data.matchNextCursor);},
  onMatchRetry(){if(this._matchTarget)return this.matchPage(this._matchTarget.index,this._matchTarget.cursor);},
  onRetry() { dictionary.reset(); this.load(this._query,{anchor:this._requestedAnchor}); },
  async onFavorite() {
    if (!this._entry) return;
    try { const item = store.favorite(this._entry.word); if (item && (item.note||item.groups.length) && !await ui.confirm('移出生词本？', '这个词的本地笔记和分组归属也会移除。')) return;
      store.toggle(this._entry.word, this._entry.brief || this._entry.zh || (this._entry.teaching || {}).title); this.refreshFavorite();
    } catch (error) { ui.error(error); }
  },
  onGroups(){if(this._entry)this.setData({groupPicker:true,groupingMeaning:this._entry.brief||this._entry.zh||(this._entry.teaching||{}).title||''});},
  onGroupClose(){this.setData({groupPicker:false});},
  onGroupSaved(){const note=this.data.note,status=this.data.noteStatus;this.refreshFavorite();if(status==='尚未保存')this.setData({note,noteStatus:status});this.setData({groupPicker:false});},
  onNote(event) { this.setData({ note: event.detail.value, noteStatus: '尚未保存' }); },
  onSaveNote() { if (!this._entry) return; try { store.saveNote(this._entry.word, this._entry.brief || this._entry.zh || (this._entry.teaching || {}).title, this.data.note); this.setData({ favorite: true, noteStatus: '已保存到本机' }); wx.showToast({ title: '笔记已保存', icon: 'success' }); } catch (error) { ui.error(error); } },
  onCopy() { if (this._entry) wx.setClipboardData({ data: this._entry.word }); },
  async onSpeak(event){
    if(!this._entry)return;const variant=ui.dataset(event,'variant')==='UK'?'UK':'US';
    if(this.data.speakingVariant===variant){this._voiceGeneration=(this._voiceGeneration||0)+1;if(this._pronunciation)this._pronunciation.cancel();this.setData({speakingVariant:'',voiceStatus:'已停止发音'});return;}
    const generation=this._voiceGeneration=(this._voiceGeneration||0)+1;if(!this._pronunciation)this._pronunciation=new Pronunciation();this.setData({speakingVariant:variant,voiceStatus:'正在准备发音…',speakingExample:-1,exampleStatusIndex:-1,exampleStatus:''});
    try{await this._pronunciation.play(this._entry,{variant,onStart:info=>{if(generation===this._voiceGeneration)this.setData({voiceStatus:voiceLabel(info)});}});}
    catch(error){if(generation===this._voiceGeneration){this.setData({voiceStatus:error.message});ui.error(error);}}
    finally{if(generation===this._voiceGeneration)this.setData({speakingVariant:''});}
  },
  onAI(){if(this._entry){getApp().globalData.aiWord=this._entry.word;wx.switchTab({url:'/pages/ai/index'});}},
  onKnown(){if(!this._entry)return;try{study.known(this._entry.word,true);wx.showToast({title:'已标为掌握'});}catch(error){ui.error(error);}},
  stopExampleVoice(){if(this.data.speakingExample<0)return;this._voiceGeneration=(this._voiceGeneration||0)+1;if(this._pronunciation)this._pronunciation.cancel();this.setData({speakingExample:-1,exampleStatusIndex:-1,exampleStatus:''});},
  async onSpeakExample(event){
    if(!this._entry)return;const index=this.data.page*8+Number(ui.dataset(event,'index')),item=((this._entry.oxford||{}).examples||[])[index];if(!item)return;
    if(this.data.speakingExample===index){this.stopExampleVoice();return;}
    const generation=this._voiceGeneration=(this._voiceGeneration||0)+1;if(!this._pronunciation)this._pronunciation=new Pronunciation();this.setData({speakingVariant:'',voiceStatus:'',speakingExample:index,exampleStatusIndex:index,exampleStatus:'正在准备朗读…'});
    try{await this._pronunciation.play(this._entry,{text:item.en,kind:'example',onStart:info=>{if(generation===this._voiceGeneration)this.setData({exampleStatus:voiceLabel(info)});}});}
    catch(error){if(generation===this._voiceGeneration){this.setData({exampleStatus:error.message});ui.error(error);}}
    finally{if(generation===this._voiceGeneration)this.setData({speakingExample:-1});}
  },
  onSaveExample(event){if(!this._entry)return;const index=this.data.page*8+Number(ui.dataset(event,'index'));const item=((this._entry.oxford||{}).examples||[])[index];if(item)try{sentences.save(item.en,item.zh,'牛津十版 · '+this._entry.word);wx.showToast({title:'例句已收藏'});}catch(error){ui.error(error);}},
  onHide(){this._voiceGeneration=(this._voiceGeneration||0)+1;if(this._pronunciation){this._pronunciation.release();this._pronunciation=null;}media.stopAudio();if(!this._unloaded)this.setData({speakingVariant:'',voiceStatus:'',speakingExample:-1,exampleStatusIndex:-1,exampleStatus:''});},
  onUnload() { this._unloaded=true;this._generation = (this._generation || 0) + 1;this.onHide(); },
  onShareAppMessage() { const anchor=this._requestedAnchor||'',unique=((((this._entry||{}).oxford||{}).anchors||[]).filter(row=>row.id===anchor).length===1);return { title: this._entry ? this._entry.word + ' · 涵词典' : '涵词典', path: '/pages/entry/index?q=' + encodeURIComponent(this._query)+(anchor&&unique?'&anchor='+encodeURIComponent(anchor):'')+(this._entry&&this._entry.referenceLabel?'&ref=1&label='+encodeURIComponent(this._entry.referenceLabel):'') }; }
});
