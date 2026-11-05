const pack = require('../../services/offline-pack');
const ui = require('../../utils/ui');
const api=require('../../services/api');
Page({
  data: { theme: 'light', installed: false, broken: false, working: false, progress: 0, message: '', error: '', title: '', definitions: 0, redirects: 0, size: '', selectedFiles: [],mediaChecking:false,mediaStatus:'',mediaReady:false },
  onLoad(){this._volumes=[];this._attempted=false;},
  update(value){if(!this._unloaded)this.setData(value);},
  onShow() { this._unloaded=false;ui.apply(this);this.refresh();this.onCheckMedia();clearInterval(this._poll);this._poll=setInterval(()=>{if(pack.progress().working||this.data.working)this.refresh();},1000); },
  async onCheckMedia(){if(this.data.mediaChecking)return;this.update({mediaChecking:true});try{const state=await api.request('dictionary-media/status',{},'GET',1500);this.update({mediaReady:state.available,mediaStatus:state.available?'配套服务已导入 '+state.audio+' 个录音、'+state.images+' 张插图':state.reason});}catch(error){this.update({mediaReady:false,mediaStatus:error.message});}finally{this.update({mediaChecking:false});}},
  onHide(){clearInterval(this._poll);},
  async refresh() {
    const state=await pack.status(),activity=pack.progress();
    const changes=Object.assign({},state,{broken:!!state.error,error:state.error||'',size:state.bytes?(state.bytes/1048576).toFixed(1)+' MiB':''});
    if(activity.working||this._attempted)Object.assign(changes,activity,{error:state.error||activity.error||''});
    this.update(changes);
  },
  showSelection(message){
    this._attempted=false;
    this.update({selectedFiles:(this._volumes||[]).map(file=>({key:file.name.toLowerCase(),name:file.name,size:(file.size/1048576).toFixed(1)+' MiB'})),error:'',progress:0,message});
  },
  onChooseFiles() {
    if(this._choosing||this.data.working||this.data.installed||this.data.broken)return;
    this._choosing=true;
    wx.chooseMessageFile({count:Math.max(1,5-(this._volumes||[]).length),type:'file',extension:['zip'],success:result=>{
      this._choosing=false;if(this._unloaded)return;
      try{
        const selected=new Map((this._volumes||[]).map(file=>[file.name.toLowerCase(),file]));
        for(const file of result.tempFiles||[]){
          if(!file||typeof file.path!=='string'||!file.path)throw new Error('无法读取所选文件');
          const name=file.name||file.path.split(/[\\/]/).pop();
          if(typeof name!=='string'||!name.toLowerCase().endsWith('.zip'))throw new Error('只支持 ZIP 词库分卷');
          selected.set(name.toLowerCase(),{name,path:file.path,size:Number(file.size)||0});
        }
        if(selected.size>5)throw new Error('最多选择 5 个 ZIP，请先移除多余分卷');
        this._volumes=Array.from(selected.values());
        this.showSelection('已选择 '+this._volumes.length+' 个 ZIP；选齐同批分卷后开始导入');
      }catch(error){this.update({error:error.message});}
    },fail:error=>{this._choosing=false;if(!this._unloaded&&!/cancel/.test(error.errMsg||''))ui.error(new Error('无法选择词库文件'));}});
  },
  onRemoveFile(event){
    if(this.data.working)return;
    const index=Number(event.currentTarget.dataset.index);
    if(!Number.isInteger(index)||index<0||index>=(this._volumes||[]).length)return;
    this._volumes.splice(index,1);this.showSelection(this._volumes.length?'已更新待导入分卷':'请选择索引卷和全部数据卷');
  },
  async onImport(){
    if(this.data.working||this.data.installed||!(this._volumes||[]).length)return;
    this._attempted=true;this.update({working:true,progress:0,message:'检查词库分卷',error:''});
    try{
      await pack.install(this._volumes.map(file=>file.path),(message,value)=>this.update({message,progress:Math.min(100,Math.round(value))}));
      this._volumes=[];this.update({selectedFiles:[],message:'牛津词库已完整导入',progress:100});await this.refresh();
    }catch(error){this.update({error:error.message,message:'导入未完成，已选分卷保留，可补齐后重试'});}
    finally{this.update({working:false});}
  },
  async onImportService(){
    if(this.data.working||this.data.installed||this.data.broken)return;
    this._attempted=true;this.update({working:true,progress:0,message:'读取配套服务的分卷清单',error:''});
    try{await pack.installFromService((message,progress)=>this.update({message,progress}));this._volumes=[];this.update({selectedFiles:[],message:'已从配套服务完整导入牛津词库',progress:100});await this.refresh();}
    catch(error){this.update({error:error.message,message:'导入未完成，学习记录保留，可重新开始'});}
    finally{this.update({working:false});}
  },
  async onRemove() { if (this.data.working || !await ui.confirm('移除离线牛津词库？', '只移除已导入的词库文件，生词本、笔记和历史会保留。')) return; try { await pack.remove(); this.update({ message: '离线词库已移除', progress: 0 }); await this.refresh(); } catch (error) { ui.error(error); } },
  onUnload() { this._unloaded = true;clearInterval(this._poll); }
});
