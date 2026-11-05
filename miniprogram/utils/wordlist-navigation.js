const context=require('./lookup-context'),ui=require('./ui');
function navigate(word,label,anchor,related,searchRelated){
 if(!word)return;const reference=related?context.putRelated(word,related):'',match=searchRelated?context.put(word,label):'';
 const url='/pages/entry/index?q='+encodeURIComponent(word)+'&ref=1&label='+encodeURIComponent(label||word)+(anchor?'&anchor='+encodeURIComponent(anchor):'')+(reference?'&relatedRef='+reference:'')+(match?'&matchRef='+match+'&fromList=1':'');
 wx.navigateTo({url,fail(){context.discard(reference);context.discard(match);ui.error(new Error('暂时无法打开词条，请返回一层后重试'));}});
}
function open(row){if(row)navigate(row.query||row.word,row.word,row.anchor||'',row.relatedWord||'',false);}
function openRelated(row){if(row&&row.relatedWord)navigate(row.relatedWord,row.word,'','',true);}
module.exports={open,openRelated};
