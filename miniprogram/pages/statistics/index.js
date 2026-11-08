const statistics=require('../../services/study-statistics'),ui=require('../../utils/ui');
Page({
 data:{theme:'light',date:'',today:'',start:'',period:7,filter:'all',days:[],selected:{},summary:{},rows:[],recorded:0,total:0,page:0,pages:0,partial:false,error:''},
 onShow(){ui.apply(this);this.refresh();},
 refresh(changes={}){try{this.setData(Object.assign({error:''},statistics.read(Object.assign({date:this.data.date,period:this.data.period,filter:this.data.filter,page:this.data.page},changes))));}catch(error){this.setData({error:error.message});}},
 onDate(event){this.refresh({date:event.detail.value,page:0});},
 onToday(){this.refresh({date:this.data.today,page:0});},
 onPeriod(event){this.refresh({period:Number(ui.dataset(event,'period')),page:0});},
 onFilter(event){this.refresh({filter:ui.dataset(event,'filter'),page:0});},
 onPrev(){this.refresh({page:this.data.page-1});},onNext(){this.refresh({page:this.data.page+1});},
 onWord(event){ui.open(ui.dataset(event,'word'));}
});
