const tabs=require('../data/tabs');
const store=require('../utils/store');
Component({
  data:{items:tabs,selected:0,theme:'light',keyboard:false},
  lifetimes:{
    attached(){
      this.sync();
      this._onKeyboard=event=>this.setData({keyboard:event.height>0});
      if(wx.onKeyboardHeightChange)wx.onKeyboardHeightChange(this._onKeyboard);
    },
    detached(){if(this._onKeyboard&&wx.offKeyboardHeightChange)wx.offKeyboardHeightChange(this._onKeyboard);}
  },
  methods:{
    sync(){
      const pages=getCurrentPages(),current=pages[pages.length-1],selected=tabs.findIndex(tab=>current&&tab.pagePath===current.route);
      const settings=store.settings();let system='light';
      try{system=wx.getAppBaseInfo?wx.getAppBaseInfo().theme:wx.getSystemInfoSync().theme;}catch(_){}
      this.setData({selected:selected<0?0:selected,theme:settings.theme==='dark'||settings.theme==='system'&&system==='dark'?'dark':'light'});
    },
    onSwitch(event){
      const index=Number(event.currentTarget.dataset.index);
      if(this._switching||!Number.isInteger(index)||!tabs[index]||index===this.data.selected)return;
      this._switching=true;
      wx.switchTab({url:'/'+tabs[index].pagePath,success:()=>this.setData({selected:index}),complete:()=>{this._switching=false;}});
    }
  }
});
