const store=require('../../utils/store');
const ui=require('../../utils/ui');
Component({
 options:{styleIsolation:'apply-shared'},
 properties:{visible:{type:Boolean,value:false},word:{type:String,value:''},words:{type:Array,value:[]},meaning:{type:String,value:''},theme:{type:String,value:'light'}},
 data:{choices:[],selectedIds:[],count:0,busy:false},
 observers:{'visible, word, words':function(){if(this.properties.visible)this.refresh();}},
 methods:{
  targets(){return this.properties.words.length?this.properties.words:[this.properties.word].filter(Boolean);},
  refresh(preferred){
   try{
    const words=this.targets(),favorites=new Map(store.favorites().map(item=>[store.key(item.word),item])),members=words.map(word=>(favorites.get(store.key(word))||{}).groups||[]);
    const selected=preferred||((members[0]||[]).filter(id=>members.every(values=>values.includes(id))));
    this.setData({choices:store.groups().map(item=>({id:item.id,name:item.name,count:item.count,checked:selected.includes(item.id)})),selectedIds:selected,count:words.length});
   }catch(error){ui.error(error);}
  },
  onChange(event){this.setData({selectedIds:event.detail.value});},
  onCreate(){wx.showModal({title:'新建生词本',editable:true,placeholderText:'名称，最多 40 字',success:result=>{if(!result.confirm)return;try{const id=store.createGroup(result.content);this.refresh(this.data.selectedIds.concat(id));}catch(error){ui.error(error);}}});},
  onCancel(){this.triggerEvent('close');},
  onSave(){if(this.data.busy)return;this.setData({busy:true});try{const count=store.setGroupsMany(this.targets(),this.data.selectedIds,this.properties.meaning);this.triggerEvent('save',{count});this.triggerEvent('close');wx.showToast({title:'分组已保存',icon:'success'});}catch(error){ui.error(error);}finally{this.setData({busy:false});}}
 }
});
