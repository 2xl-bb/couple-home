const $=s=>document.querySelector(s), OLD_KEY='our-little-days-v1';
const {requestFailureMessage,photoNearViewport,createDraftStore}=LittleDaysHelpers;
const STANDALONE_MODE=window.LITTLE_DAYS_STANDALONE===true;
const API_ORIGIN=window.LITTLE_DAYS_API_ORIGIN||'',PAGES_MODE=!!API_ORIGIN,ownerSignIn=STANDALONE_MODE?'#':API_ORIGIN+'/signin-with-chatgpt?return_to=%2F';
if('serviceWorker'in navigator&&(location.protocol==='https:'||location.hostname==='localhost'||location.hostname==='127.0.0.1'))window.addEventListener('load',()=>navigator.serviceWorker.register('/sw.js',{scope:'/'}).catch(()=>{}));
const DEVICE_KEY='little-days-device-session:'+API_ORIGIN;let rememberedSession=null;try{const saved=JSON.parse(localStorage.getItem(DEVICE_KEY)||'null');if(saved&&saved.expiresAt>Date.now()&&/^[a-f0-9]{64}$/.test(saved.token))rememberedSession=saved;else localStorage.removeItem(DEVICE_KEY)}catch{}
let pagesToken=rememberedSession?.token||'';function forgetDevice(){pagesToken='';rememberedSession=null;try{localStorage.removeItem(DEVICE_KEY)}catch{}}
const photoCache=new Map();
function backendFetch(path,options={}){const headers=new Headers(options.headers||{});if(PAGES_MODE&&pagesToken)headers.set('Authorization','Bearer '+pagesToken);return fetch(API_ORIGIN+path,{...options,headers,credentials:PAGES_MODE?'omit':'same-origin'})}
function photoSource(id){return PAGES_MODE?(photoCache.get(id)?.url||'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7'):'/api/photos/'+encodeURIComponent(id)}
let photoLoadRunning=false,photoLoadAgain=false;
const photoFailures=new Map();
async function loadPagesPhotos(){
 if(!PAGES_MODE||!pagesToken||!ready||!document.body.dataset.roomPage)return;
 const ids=new Set(state.photos.map(p=>p.id));for(const id of photoFailures.keys())if(!ids.has(id))photoFailures.delete(id);for(const[id,p]of photoCache)if(!ids.has(id)){if(p.url)URL.revokeObjectURL(p.url);photoCache.delete(id)}
 if(photoLoadRunning){photoLoadAgain=true;return}
 const visible=new Set([...document.querySelectorAll('[data-photo-id]')].filter(img=>photoNearViewport(img,window.innerHeight)).map(img=>img.dataset.photoId));
 const waiting=state.photos.filter(p=>visible.has(p.id)&&!photoCache.has(p.id)&&Date.now()>=(photoFailures.get(p.id)?.retryAt||0));if(!waiting.length)return;
 photoLoadRunning=true;let index=0;
 try{await Promise.all(Array.from({length:Math.min(3,waiting.length)},async()=>{
  while(index<waiting.length&&ready&&pagesToken){const p=waiting[index++];if(photoCache.has(p.id))continue;const entry={url:''};photoCache.set(p.id,entry);
   try{const r=await backendFetch('/api/photos/'+encodeURIComponent(p.id),{signal:AbortSignal.timeout(20000)});if(photoCache.get(p.id)!==entry)continue;if(r.status===401){showLogin('登录已过期，请重新回家。');return}if(!r.ok||!(r.headers.get('content-type')||'').startsWith('image/'))throw new Error('照片暂时未能读取');
    const url=URL.createObjectURL(await r.blob());if(photoCache.get(p.id)!==entry){URL.revokeObjectURL(url);continue}entry.url=url;photoFailures.delete(p.id);
    document.querySelectorAll('[data-photo-id]').forEach(img=>{if(img.dataset.photoId===p.id)img.src=url})
   }catch{if(photoCache.get(p.id)===entry){photoCache.delete(p.id);const count=(photoFailures.get(p.id)?.count||0)+1;photoFailures.set(p.id,{count,retryAt:Date.now()+Math.min(120000,12000*2**Math.min(count-1,4))})}}
  }
 }))}finally{photoLoadRunning=false;if(photoLoadAgain){photoLoadAgain=false;queueMicrotask(loadPagesPhotos)}}
}
// Keep stable photo and card nodes across polls, so images and keyboard focus survive.
const renderedContent=new WeakMap();
function renderContent(selector,html){const el=$(selector);if(renderedContent.get(el)===html)return;el.innerHTML=html;renderedContent.set(el,html)}
window.addEventListener('little-days-page-change',loadPagesPhotos);
let photoScrollFrame=0;function schedulePhotoLoad(){if(!PAGES_MODE||!ready||photoScrollFrame)return;photoScrollFrame=requestAnimationFrame(()=>{photoScrollFrame=0;loadPagesPhotos()})}
window.addEventListener('scroll',schedulePhotoLoad,{passive:true});window.addEventListener('resize',schedulePhotoLoad,{passive:true});$('#modal').addEventListener('scroll',schedulePhotoLoad,{passive:true});

const empty=()=>({v:2,names:['你','我'],start:'',intro:'',stories:[],photos:[],videos:[],wishes:[],letters:[],anniversaries:[],moods:{},pet:{name:'团团',kind:'cat',color:'cream',bornAt:Date.now(),updatedAt:Date.now(),fullness:75,happiness:80,energy:85,xp:0,sleepingUntil:0,careLog:[]}});
let state=empty(),me=null,members=[],revision=-1,ready=false,loginRequired=false,pending=0,polling=false,received=0,requestId=0,queue=Promise.resolve(),toastTimer;
let syncTag='',syncFailures=0,nextSyncAt=0;
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const roleLabel=slot=>STANDALONE_MODE?((window.LittleDaysEntry?.identityNames||['成员一','成员二'])[Number(slot)-1]||'小屋成员'):Number(slot)===1?'成员一':Number(slot)===2?'成员二':'小屋成员';
const uid=()=>typeof crypto.randomUUID==='function'?crypto.randomUUID():Date.now().toString(36)+'-'+Math.random().toString(36).slice(2);
const today=()=>new Date(Date.now()+8*3600e3).toISOString().slice(0,10);
const daynum=s=>{const p=s.split('-').map(Number);return Date.UTC(p[0],p[1]-1,p[2])/86400000};const fmt=s=>String(s??'').replaceAll('-','.');
function toast(msg){$('#toast').textContent=msg;$('#toast').classList.add('visible');clearTimeout(toastTimer);toastTimer=setTimeout(()=>$('#toast').classList.remove('visible'),3800)}
function status(text,error=false){$('#sync-status').textContent=text;$('#sync-refresh').classList.toggle('error',error)}
function showLogin(message='选择你的身份，输入密码就能回家。'){loginRequired=true;syncTag='';if(typeof LittleDaysAlbum!=='undefined')LittleDaysAlbum.reset();const dialog=$('#modal');if(dialog.open)dialog.close();dialog.dataset.busy='0';for(const entry of photoCache.values())if(entry.url)URL.revokeObjectURL(entry.url);photoCache.clear();photoFailures.clear();if(PAGES_MODE)forgetDevice();document.body.classList.add('home-locked');$('#login-gate').hidden=false;$('#login-note').textContent=message;ready=false;}
function connection(message,login=false){const b=$('#connection-banner');b.hidden=false;b.replaceChildren();b.append(document.createTextNode(message));if(login){const a=document.createElement('a');a.href=ownerSignIn;a.target='_top';a.textContent=STANDALONE_MODE?'重新登录 →':'使用 ChatGPT 登录 →';if(STANDALONE_MODE)a.onclick=e=>{e.preventDefault();showLogin()};b.append(a)}}
function connectionProblem(message){const e=new Error(message);e.connection=true;return e}
async function api(path,options={}){
 let res;try{res=await backendFetch(path,{...options,cache:'no-store',signal:AbortSignal.timeout(20000)})}catch(error){throw connectionProblem(requestFailureMessage(error))}
 const type=res.headers.get('content-type')||'';
 if(!type.includes('application/json')){
  if(res.status===403)throw connectionProblem('小屋入口拒绝了这次访问，可能是平台安全防护拦截。密码尚未验证，请检查连接后重试。');
  throw connectionProblem('小屋接口暂时没有返回正常内容，可能是入口登录页或服务异常。请检查连接后重试。');
 }
 let data;try{data=await res.json()}catch{throw connectionProblem('小屋返回的内容不完整，请重新检查连接。')}
 if(!res.ok){const e=new Error(data.error||'连接没有成功，请重试。');e.status=res.status;if(res.status===401&&path!=='/api/auth')showLogin(data.error);throw e}return data;
}
function showConnectionRetry(visible){$('#login-retry').hidden=!visible}

function accept(data,seq){
 if(seq<received||data.revision<revision)return;
 if(data.identityNames&&typeof window!=='undefined')window.LittleDaysEntry?.applyNames(data.identityNames);
 received=seq;if(data.state)state=data.state;me=data.me;members=data.members;revision=data.revision;syncTag=data.syncTag||'';syncFailures=0;nextSyncAt=0;ready=true;loginRequired=false;
 document.body.classList.remove('home-locked');$('#login-gate').hidden=true;$('#connection-banner').hidden=true;showConnectionRetry(false);status('云端已同步');$('#sync-refresh').title='最近同步：'+new Date().toLocaleTimeString('zh-CN');
 if(data.unchanged){renderMemberStatus();loadPagesPhotos();return}render();
}
async function sync(force=false){
 if(polling||pending||loginRequired||(!force&&Date.now()<nextSyncAt))return;
 polling=true;const id=++requestId;
 try{accept(await api('/api/home'+(ready&&syncTag?'?since='+encodeURIComponent(syncTag):'')),id)}
 catch(e){status(e.status===401?'请先登录':'暂未连接',true);if(e.status!==401){syncFailures++;nextSyncAt=Date.now()+Math.min(120000,12000*2**Math.min(syncFailures,4));connection(e.message+' 连接恢复后会继续同步。');if(!ready){$('#login-note').textContent=e.message;showConnectionRetry(true)}}}
 finally{polling=false}
}
async function refreshNow(){const seq=++requestId;accept(await api('/api/home'),seq)}

function mutate(kind,payload){const op={id:uid(),kind,payload};const task=queue.then(async()=>{if(!ready)throw new Error('请先连接并登录云端小屋。');pending++;status('正在收藏…');const seq=++requestId;try{const options={method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(op)};let result;try{result=await api('/api/home',options)}catch(err){if(err.status)throw err;result=await api('/api/home',options)}accept(result,seq);return true}catch(e){status('保存未完成',true);throw e}finally{pending--}});queue=task.catch(()=>{});return task}
function close(){if($('#modal').dataset.busy==='1'){toast('正在整理或恢复，请稍候。');return}$('#modal').close()}function modal(title,html=''){$('#modal-title').textContent=title;$('#modal-content').innerHTML=html;$('#modal').showModal()}
function formSnapshot(form){return JSON.stringify([...new FormData(form)].map(([key,value])=>[key,typeof value==='string'?value:{name:value.name,size:value.size,lastModified:value.lastModified}]))}
function unsavedModalForm(){const f=$('#active-form');return $('#modal').open&&f&&(f.dataset.saving==='1'||formSnapshot(f)!==f.dataset.original)}
function requestModalClose(){const f=$('#active-form');if($('#modal').dataset.busy==='1'||f?.dataset.saving==='1'){toast('正在保存或整理，请稍候。');return false}if(unsavedModalForm()&&!confirm('内容还没有保存，确定放下这次编辑吗？'))return false;close();return true}
$('#modal').addEventListener('cancel',e=>{e.preventDefault();requestModalClose()});$('#close-modal').onclick=requestModalClose;$('#modal').addEventListener('click',e=>{if(e.target===$('#modal')){const r=$('#modal').getBoundingClientRect();if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom)requestModalClose()}});
window.addEventListener('beforeunload',e=>{if(unsavedModalForm()){e.preventDefault();e.returnValue=''}});
function field(label,name,type='text',value='',extra=''){return `<label class="form-field">${esc(label)}<input name="${name}" type="${type}" value="${esc(value)}" ${extra}></label>`}
function form(html,onSubmit,draftKind=''){$('#modal-content').innerHTML=`<form id="active-form">${html}<div class="form-actions"><button type="button" class="outline" id="cancel">取消</button><button class="primary" type="submit">好好收藏 ♡</button></div></form>`;$('#cancel').onclick=requestModalClose;const activeForm=$('#active-form');activeForm.dataset.original=formSnapshot(activeForm);if(draftKind)attachDraft(activeForm,draftKind);activeForm.onsubmit=async e=>{e.preventDefault();if(activeForm.dataset.saving==='1')return;if($('#modal').dataset.busy==='1'){toast('正在整理文件，请稍候再保存。');return;}const btn=e.submitter||activeForm.querySelector('[type=submit]');activeForm.dataset.saving='1';btn.disabled=true;try{await onSubmit(new FormData(activeForm));activeForm.clearDraft?.()}catch(err){toast(err.message||'没有保存成功，请重试。')}finally{activeForm.dataset.saving='0';btn.disabled=false}}}
function needReady(){if(ready)return true;toast('请先登录并连接云端小屋。');return false}
function nextAnnual(date){const[,m,d]=date.split('-').map(Number);let year=Number(today().slice(0,4));const candidate=y=>{const last=new Date(Date.UTC(y,m,0)).getUTCDate();return `${y}-${String(m).padStart(2,'0')}-${String(Math.min(d,last)).padStart(2,'0')}`};let s=candidate(year);if(s<today())s=candidate(++year);return{date:s,days:daynum(s)-daynum(today())}}
function renderMemberStatus(){
 renderContent('#member-status',members.length?[1,2].map(slot=>{const m=members.find(x=>x.slot===slot);return `<span><i class="${m?.online?'online':''}"></i>${esc(state.names[slot-1])}${slot===me?.slot?'（我）':m?.joined?'':' · 等待入住'}</span>`}).join(''):'<span>登录后，就能把回忆同步到这里。</span>');
}
const videoButton=document.createElement('button');videoButton.type='button';videoButton.id='add-video';videoButton.className='album-icon-button';videoButton.textContent='▸';videoButton.title='添加视频';videoButton.setAttribute('aria-label','添加视频');$('#add-photo').after(videoButton);
const videoSection=document.createElement('section');videoSection.className='video-section';videoSection.innerHTML='<h3>视频</h3><div id="video-list" class="video-list"></div>';$('#photo-list').after(videoSection);
let albumMonth='',albumSort='desc';
const ALBUM_MONTH_PAGE_SIZE=24,albumOpenMonths=new Set(),albumMonthLimits=new Map();
function photoTakenTime(photo){return Number(photo.taken_at)||Number(photo.created_at)||0}
function albumPhotos(){return typeof LittleDaysAlbum!=='undefined'?LittleDaysAlbum.filter(state.photos,albumMonth):state.photos.filter(p=>!albumMonth||new Date(photoTakenTime(p)+8*3600e3).toISOString().startsWith(albumMonth))}
function sortedAlbumPhotos(){const direction=albumSort==='desc'?-1:1;return [...albumPhotos()].sort((a,b)=>direction*(photoTakenTime(a)-photoTakenTime(b)||String(a.id).localeCompare(String(b.id))));}
function albumDateKey(photo){const value=photoTakenTime(photo);if(!Number.isFinite(value)||value<=0)return{year:'未定',month:'日期',key:'unknown'};const [year,month]=new Date(value+8*3600e3).toISOString().slice(0,7).split('-');return{year,month:String(Number(month)),key:`${year}-${month}`}}
function groupAlbumPhotos(photos){const years=[];for(const photo of photos){const date=albumDateKey(photo);let year=years.at(-1);if(!year||year.year!==date.year){year={year:date.year,months:[]};years.push(year)}let month=year.months.at(-1);if(!month||month.key!==date.key){month={key:date.key,label:date.month,photos:[]};year.months.push(month)}month.photos.push(photo)}return years}
function resetAlbumTimeline(){albumOpenMonths.clear();albumMonthLimits.clear()}
function photoCard(photo){return `<article class="photo-item has-photo"><button type="button" class="photo-open" data-view-photo="${esc(photo.id)}" aria-label="查看大图：${esc(photo.caption||'我们的回忆')}"><img data-photo-id="${esc(photo.id)}" src="${photoSource(photo.id)}" alt="${esc(photo.caption||'我们的回忆')}" loading="lazy" decoding="async"></button>${photoCaptionTimeline(photo)}${photo.ai?`<p class="album-tags">${esc(photo.ai.category)} · ${photo.ai.tags.slice(0,3).map(esc).join(' · ')}</p>`:''}<button class="photo-caption-add" data-add-photo-caption="${esc(photo.id)}" aria-label="为照片追加留言" title="追加留言">✎</button><button class="photo-delete" data-remove-photo="${esc(photo.id)}" aria-label="删除照片" title="移除照片">×</button></article>`}
function monthTimeline(month){const open=albumOpenMonths.has(month.key),limit=albumMonthLimits.get(month.key)||ALBUM_MONTH_PAGE_SIZE,shown=open?month.photos.slice(0,limit):[];return `<section class="album-month${open?' is-open':''}" data-month="${month.key}"><button type="button" class="album-month-toggle" data-toggle-album-month="${month.key}" aria-expanded="${open}"><span>${esc(month.label)}月</span><span><small>${month.photos.length}</small><i aria-hidden="true">⌄</i></span></button>${open?`<div class="album-month-panel"><div class="photo-grid">${shown.map(photoCard).join('')}</div>${shown.length<month.photos.length?`<button type="button" class="album-month-more" data-more-album-month="${month.key}" aria-label="继续加载 ${esc(month.label)} 月照片" title="继续加载">＋</button>`:''}</div>`:''}</section>`}
function photoCaptionTimeline(photo){const items=Array.isArray(photo.captions)&&photo.captions.length?photo.captions:photo.caption?[{id:'original',text:photo.caption,createdAt:photo.created_at,authorSlot:null,original:true}]:[];if(!items.length)return'<p class="photo-caption-empty">还没有写下配文。</p>';return`<div class="photo-caption-list">${items.map((item,index)=>{const original=item.original||index===0&&item.id==='original',author=item.authorSlot?state.names[item.authorSlot-1]||`成员${item.authorSlot}`:'';return`<div class="photo-caption-entry${original?' is-original':' is-addition'}"><div><span>${original?'原配文':'补充'}${author?' · '+esc(author):''}</span><time>${new Date(item.createdAt||photo.created_at).toLocaleString('zh-CN',{year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit'})}</time></div><p>${esc(item.text)}</p></div>`}).join('')}</div>`}
function renderAlbum(){
 state.videos=Array.isArray(state.videos)?state.videos:[];
 const photos=sortedAlbumPhotos(),years=groupAlbumPhotos(photos),keys=new Set(years.flatMap(year=>year.months.map(month=>month.key)));
 for(const key of [...albumOpenMonths])if(!keys.has(key))albumOpenMonths.delete(key);
 if(!albumOpenMonths.size&&years[0]?.months[0])albumOpenMonths.add(years[0].months[0].key);
 const count=$('#album-count');count.textContent=photos.length?String(photos.length):'';count.setAttribute?.('aria-label',photos.length?`${photos.length} 张照片`:state.photos.length?'没有符合当前搜索的照片':'相册为空');
 const sort=$('#album-sort');sort.textContent=albumSort==='desc'?'↓':'↑';sort.title=albumSort==='desc'?'最新在前':'最早在前';sort.setAttribute?.('aria-label',albumSort==='desc'?'当前最新在前，切换为最早在前':'当前最早在前，切换为最新在前');
 if(typeof LittleDaysAlbum!=='undefined')LittleDaysAlbum.renderTools();
 renderContent('#photo-list',years.length?years.map(year=>`<section class="album-year"><h3>${esc(year.year)}${year.year==='未定'?'':'年'}</h3>${year.months.map(monthTimeline).join('')}</section>`).join(''):`<button type="button" class="album-empty" data-upload aria-label="添加照片" title="添加照片">＋</button>`);
 if(typeof videoButton!=='undefined'){videoButton.hidden=!me?.videoEnabled;renderContent('#video-list',state.videos.length?state.videos.map(v=>`<article class="video-card"><div><strong>${esc(v.caption||'一段共同视频')}</strong><small>${(v.sizeBytes/1024/1024).toFixed(1)} MB · ${new Date(v.created_at).toLocaleDateString('zh-CN')}</small></div><div><button class="outline" data-view-video="${esc(v.id)}">播放</button><button class="remove" data-remove-video="${esc(v.id)}">移除</button></div></article>`).join(''):'<p class="form-help">还没有共同视频。</p>')}
}
$('#album-sort').onclick=()=>{albumSort=albumSort==='desc'?'asc':'desc';resetAlbumTimeline();renderAlbum();loadPagesPhotos()};
$('#photo-list').addEventListener?.('click',event=>{const button=event.target.closest?.('button');if(!button)return;const toggle=button.dataset.toggleAlbumMonth,more=button.dataset.moreAlbumMonth;if(toggle){event.preventDefault();if(albumOpenMonths.has(toggle))albumOpenMonths.delete(toggle);else{albumOpenMonths.clear();albumOpenMonths.add(toggle)}renderAlbum();loadPagesPhotos()}else if(more){event.preventDefault();albumMonthLimits.set(more,(albumMonthLimits.get(more)||ALBUM_MONTH_PAGE_SIZE)+ALBUM_MONTH_PAGE_SIZE);renderAlbum();loadPagesPhotos()}});
function viewPhoto(id){
 const photos=sortedAlbumPhotos().map(p=>({...p}));let index=photos.findIndex(p=>p.id===id);if(index<0||!needReady())return;
 const draw=()=>{const p=photos[index];modal('这一刻，想和你再看一遍',`<div class="photo-viewer"><img data-photo-id="${esc(p.id)}" src="${photoSource(p.id)}" alt="${esc(p.caption||'我们的回忆')}"><button type="button" class="photo-date-edit" data-edit-photo-date="${esc(p.id)}">◷ ${new Date(photoTakenTime(p)).toLocaleDateString('zh-CN')} · 修改拍摄日期</button>${photoCaptionTimeline(p)}${p.ai?`<p class="photo-ai-description">AI 描述：${esc(p.ai.description)}</p>`:''}<div class="photo-viewer-nav"><button type="button" class="outline" id="photo-previous" ${index===0?'disabled':''}>← 上一张</button><span>${index+1} / ${photos.length}</span><button type="button" class="outline" id="photo-next" ${index===photos.length-1?'disabled':''}>下一张 →</button></div></div>`);$('#photo-previous').onclick=()=>{if(index>0){index--;draw()}};$('#photo-next').onclick=()=>{if(index<photos.length-1){index++;draw()}};loadPagesPhotos()};
 draw();const keyboard=e=>{if(!$('#modal').open||!$('#photo-next'))return;if(e.key==='ArrowLeft'&&index>0){e.preventDefault();index--;draw()}if(e.key==='ArrowRight'&&index<photos.length-1){e.preventDefault();index++;draw()}};$('#modal').addEventListener('keydown',keyboard);$('#modal').addEventListener('close',()=>$('#modal').removeEventListener('keydown',keyboard),{once:true});
}
function addPhotoCaption(id){if(!needReady())return;const captionId=uid(),createdAt=Date.now();modal('给这张照片补充一句');form('<label class="form-field">追加留言<textarea name="text" required maxlength="500" placeholder="写下后来想补充的细节……"></textarea></label><p class="form-help">新留言会追加在原配文下方，原来的文字不会被覆盖。</p>',async data=>{await api('/api/photos/'+encodeURIComponent(id)+'/caption',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id:captionId,text:data.get('text'),createdAt})});await refreshNow();close();toast('补充文字已保存 ♡')},'photo-caption');$('#active-form button[type="submit"]').textContent='追加到照片 ♡'}
function editPhotoDate(id){if(!needReady())return;const photo=state.photos.find(item=>item.id===id);if(!photo)return toast('照片不存在。');const value=new Date(photoTakenTime(photo)+8*3600e3).toISOString().slice(0,10);modal('修改拍摄日期');form(field('拍摄日期','takenDate','date',value,`required max="${today()}"`),async data=>{const takenAt=new Date(String(data.get('takenDate'))+'T12:00:00+08:00').toISOString();await api('/api/photos/'+encodeURIComponent(id)+'/date',{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({takenAt})});resetAlbumTimeline();await refreshNow();close();toast('拍摄日期已更新 ♡')});$('#active-form button[type="submit"]').textContent='保存日期'}
function attachDraft(activeForm,kind){
 if(!me?.slot)return;
 let store;try{store=createDraftStore(localStorage,API_ORIGIN+':'+me.slot)}catch{return}
 const saved=store.read(kind),box=document.createElement('section');let waitingForDraft=!!saved;box.className='draft-box';
 box.innerHTML='<label class="draft-choice"><input type="checkbox" id="keep-draft"> 在这台私人设备保留草稿</label><p class="form-help">仅保留这份未发送的文字，7 天后过期；不会同步给对方。共享设备请勿勾选。</p><div class="draft-actions">'+(saved?'<button type="button" class="text-button" id="restore-draft">恢复上次草稿 ↗</button>':'')+'<button type="button" class="text-button" id="clear-draft">清除本机草稿</button></div><p class="draft-status" role="status">'+(saved?'这里有一份尚未发送的草稿。':'')+'</p>';
 activeForm.querySelector('.form-actions').before(box);const toggle=box.querySelector('input'),note=box.querySelector('.draft-status');
 const save=()=>{if(!toggle.checked||waitingForDraft)return;const ok=store.write(kind,Object.fromEntries(new FormData(activeForm)));note.textContent=ok?'草稿已留在本设备，尚未发送。':'此浏览器无法保存草稿，请先复制文字再离开。'};
 activeForm.addEventListener('input',event=>{if(event.target!==toggle)save()});toggle.onchange=()=>{if(toggle.checked&&waitingForDraft){toggle.checked=false;note.textContent='请先恢复或清除上次草稿，再保存这次编辑。';return}if(toggle.checked)save();else{store.remove(kind);note.textContent='已关闭本机草稿保存。'}};
 box.querySelector('#clear-draft').onclick=()=>{waitingForDraft=false;store.remove(kind);toggle.checked=false;box.querySelector('#restore-draft')?.remove();note.textContent='已清除本机草稿，当前输入的文字仍保留。'};
 if(saved)box.querySelector('#restore-draft').onclick=()=>{if(formSnapshot(activeForm)!==activeForm.dataset.original&&!confirm('恢复草稿会替换当前输入的内容，确定继续吗？'))return;waitingForDraft=false;toggle.checked=true;for(const [name,value]of Object.entries(saved)){const input=activeForm.elements.namedItem(name);if(input)input.value=value}save();box.querySelector('#restore-draft')?.remove()};
 activeForm.clearDraft=()=>{if(!waitingForDraft)store.remove(kind)};activeForm.dataset.original=formSnapshot(activeForm);
}
function render(){
 $('#couple-name').textContent=state.names.join(' & ');$('#edit-names').textContent=state.start?'修改我们的纪念日 →':'写下我们的名字 →';
 const elapsed=state.start?Math.max(1,daynum(today())-daynum(state.start)+1):null;
 $('#days').innerHTML=(elapsed??'—')+'<small>天</small>';$('#since').textContent=state.start?`SINCE ${fmt(state.start)} · 这是我们的第 ${elapsed} 天`:'设置属于你们的第一天';
 $('#intro').textContent=state.intro||'一起吃过的饭、看过的落日，和那些不起眼的瞬间，都值得被好好收藏。';
 const ann=[...state.anniversaries];if(state.start)ann.push({id:'start',title:'我们的恋爱纪念日',date:state.start});const next=ann.map(a=>({...a,...nextAnnual(a.date)})).sort((a,b)=>a.days-b.days)[0];
 renderContent('#anniversary-content',next?`<div><span>${esc(next.title)}</span><p>${fmt(next.date)} ${next.id!=='start'?`<button class="remove" data-remove-anniversary="${esc(next.id)}" aria-label="删除纪念日">移除</button>`:''}</p></div><strong>${next.days===0?'今天':next.days}${next.days===0?'':'<small>天后</small>'}</strong>`:'<div><span>把重要的日子，放在心上。</span><p>从第一个纪念日开始记录</p></div>');
 const moods=state.moods[today()]||{},mine=moods[me?.slot],other=moods[me?.slot===1?2:1];document.querySelectorAll('[data-mood]').forEach(b=>{b.classList.toggle('selected',b.dataset.mood===mine);b.setAttribute('aria-pressed',String(b.dataset.mood===mine))});$('#mood-note').textContent=mine?`我的心情：${mine} · 已同步 ♡`:'今天，还没有留下你的心情。';$('#partner-mood').textContent=other?`${state.names[me?.slot===1?1:0]}今天：${other}`:'也给对方，留一点表达的空间。';
 const samples=[{date:'第一章',title:'故事的第一天',text:'还记得第一次见面时，说的第一句话吗？',sample:true},{date:'第二章',title:'慢慢靠近的我们',text:'第一次约会、第一张合照，那些心动的瞬间。',sample:true},{date:'未完待续',title:'下一站，还是你',text:'点一下「记下一个瞬间」，开始写你们的故事。',sample:true}];
 renderContent('#story-list',(state.stories.length?[...state.stories].sort((a,b)=>a.date.localeCompare(b.date)):samples).map(s=>`<article class="story"><time>${esc(fmt(s.date))}</time>${!s.sample?`<button class="remove" data-remove-story="${esc(s.id)}" aria-label="删除这段回忆">移除</button>`:''}<h3>${esc(s.title)}${s.sample?'<span class="sample-tag">待你书写</span>':''}</h3><p>${esc(s.text)}</p></article>`).join(''));
 renderAlbum();
 $('#wish-count').textContent=`${state.wishes.filter(w=>w.done).length} / ${state.wishes.length}`;renderContent('#wish-list',state.wishes.length?state.wishes.map(w=>`<div class="wish-row ${w.done?'done':''}"><button class="wish-toggle" data-toggle-wish="${esc(w.id)}" aria-label="${w.done?'取消完成':'完成'}：${esc(w.text)}" aria-pressed="${w.done}">${w.done?'✓':''}</button><span>${esc(w.text)}</span><button class="remove" data-remove-wish="${esc(w.id)}" aria-label="删除心愿">×</button></div>`).join(''):'<p class="form-help">一起去看海、学做一道菜、养一盆植物……<br>从一个小小的心愿开始吧。</p>');
 renderContent('#letter-list',state.letters.length?[...state.letters].reverse().map(l=>`<article class="letter ${l.locked?'locked':''}"><button class="remove" data-remove-letter="${esc(l.id)}" aria-label="删除留言">移除</button><time>${esc(l.author)} · ${fmt(l.date)}${l.openDate?` · ${fmt(l.openDate)} 打开`:''}</time><p>${l.locked?'✉ 一封写给未来的信，等约定的那天再打开。':esc(l.text)}</p></article>`).join(''):'<div class="empty-copy">“今天也很喜欢你。”<small>一句想念，一声晚安，一封写给未来的信。<br>把来不及说的话，先留在这里。</small></div>');
 renderMemberStatus();
 renderPet();loadPagesPhotos();renderBackupReminder();if(typeof renderTogether==='function'&&window.LITTLE_DAYS_FEATURES_READY)renderTogether();
}
function petArt(p){return LittleDaysPetView.art(p)}
let petLook='';function renderPet(){
 const original=state.pet;if(!original)return;const now=Date.now(),p=LittleDaysPetView.project(original,now),growth=LittleDaysPetView.currentStage(p),stage=growth.current.shape,motion=LittleDaysPetView.motion(p,now),character=$('#pet-character');
 $('#pet-name').textContent=p.name;$('#pet-level').textContent=`Lv. ${Math.floor(p.xp/100)+1} · ${growth.current.name}`;
 $('#pet-age').textContent=`住进小屋的第 ${Math.max(1,Math.floor((now-p.bornAt)/86400000)+1)} 天 · 成长值 ${p.xp}${growth.next?' / '+growth.next.start+' · 距离'+growth.next.name+'还差 '+(growth.next.start-p.xp):' · 继续积累陪伴'}`;
 renderContent('#pet-stats',[['饱饱的',p.fullness],['开心值',p.happiness],['小电量',p.energy]].map(([t,v])=>`<div class="pet-stat"><div><span>${t}</span><span>${Math.round(v)}%</span></div><div class="meter" role="meter" aria-label="${t}" aria-valuenow="${Math.round(v)}" aria-valuemin="0" aria-valuemax="100"><i style="width:${v}%"></i></div></div>`).join(''));
 const look=JSON.stringify([p.name,growth.current]);if(look!==petLook){character.innerHTML=petArt(p);petLook=look}character.dataset.stage=stage;character.dataset.state=motion;character.classList.toggle('sleeping',motion==='sleep');
 $('#pet-bubble').textContent=({sleep:'呼噜呼噜……还有 '+Math.ceil((p.sleepingUntil-now)/1000)+' 秒睡醒，小电量正在恢复。',feed:'啊呜啊呜，好香的小零食！',play:'追上小球啦！一起再跑一圈～',pet:'蹭蹭你的手，最喜欢温柔的摸摸。',duet:'两个人都在，开心得转圈圈 ♡',tired:'有一点困，想盖好被子睡一觉。',hungry:'肚子咕噜咕噜，想要一点好吃的。',lonely:'想你们啦，来摸摸我或陪我玩吧。',idle:'等你们回来，陪我待一会儿 ♡'})[motion];
 const counts={feed:0,play:0,pet:0,sleep:0,duet:0};for(const l of p.careLog)if(l.action in counts)counts[l.action]++;const favorite=Object.entries(counts).sort((a,b)=>b[1]-a[1])[0];
 $('#pet-personality').textContent=favorite[1]?({feed:'贪吃的小甜心 · 最爱你们投喂的小零食',play:'活泼的小冒险家 · 最爱和你们玩耍',pet:'黏人的小棉花 · 最爱轻轻的摸摸',sleep:'安静的小暖炉 · 最爱安心睡在你们身边',duet:'幸福的小跟班 · 最爱两个人一起陪伴'}[favorite[0]]):'性格正在萌芽，陪伴会慢慢留下痕迹。';
 $('#pet-duet').textContent=p.duet&&now-p.duet.at<300000?(p.duet.slot===me?.slot?'♡ 已邀请，等另一位回应（5分钟内）':'♡ 回应邀请，一起陪它玩'):'♡ 两个人一起陪它玩';$('#pet-duet').disabled=motion==='sleep';
 document.querySelectorAll('[data-care]').forEach(button=>{const action=button.dataset.care,last=p.careLog.find(l=>l.slot===me?.slot&&l.action===action),left=last?Math.ceil((last.at+20000-now)/1000):0;button.disabled=petCareBusy||(motion==='sleep'&&action!=='pet')||left>0;button.title=left>0?'再等 '+left+' 秒':motion==='sleep'&&action!=='pet'?'正在睡觉，睡醒后再来吧':''});
 document.querySelectorAll('.room-resident').forEach(el=>{el.dataset.state=motion;el.classList.toggle('sleeping',motion==='sleep')});
 const log=p.careLog[0];$('#pet-last-care').textContent=log?`${log.actor}${careWords[log.action]} · ${relative(log.at)}`:'第一份照顾，等你们一起开始。';
}
let petCareBusy=false;
setInterval(()=>{if(ready&&!document.hidden&&document.body.dataset.roomPage==='pet')renderPet()},1000);
const careWords={feed:'给了它一份小零食',play:'陪它玩了一会儿',pet:'轻轻摸了摸它',sleep:'帮它盖好了小被子',duet:'一起陪它玩了双人小游戏'};function relative(t){const m=Math.max(0,Math.floor((Date.now()-t)/60000));return m<1?'刚刚':m<60?`${m} 分钟前`:m<1440?`${Math.floor(m/60)} 小时前`:new Date(t).toLocaleDateString('zh-CN')}
$('#pet-settings').onclick=()=>{
 if(!needReady())return;modal('一起设计宠物与成长阶段');
 const option=(v,label,current)=>`<option value="${v}" ${v===current?'selected':''}>${label}</option>`;
 const row=(s,i)=>`<fieldset class="pet-stage-editor" data-stage-row><legend>成长阶段 ${i+1}</legend><div class="pet-stage-preview" aria-label="阶段外观预览"></div>${field('阶段名称','stageName','text',s.name,'required maxlength="12"')}${field('从多少成长值开始','stageStart','number',s.start,'required min="0" max="100000000" step="1"')}<label class="form-field">动物<select name="stageKind">${option('cat','小猫',s.kind)}${option('bunny','小兔',s.kind)}</select></label><label class="form-field">体型<select name="stageShape">${option('baby','幼小',s.shape)}${option('young','少年',s.shape)}${option('grown','成年',s.shape)}</select></label><label class="form-field">毛色<input name="stageColor" type="color" value="${esc(s.color)}"></label><label class="form-field">装饰<select name="stageAccessory">${option('default','阶段默认',s.accessory)}${option('none','不佩戴',s.accessory)}${option('bow','蝴蝶结',s.accessory)}${option('star','小星星',s.accessory)}</select></label><button type="button" class="outline" data-remove-stage>移除此阶段</button></fieldset>`;
 const initial=LittleDaysPetView.stagesFor(state.pet);
 form(field('宠物名字','name','text',state.pet.name,'required maxlength="12"')+'<p class="form-help">两位成员都可以编辑，保存后同步给对方；同时修改时以后一次保存为准。设置 2 至 5 个阶段，第一阶段从 0 开始，后续成长值依次增加。修改外观不会清空成长和照顾记录。</p><div id="pet-stage-list">'+initial.map(row).join('')+'</div><button type="button" class="outline" id="add-pet-stage">添加成长阶段</button>',async d=>{
   const names=d.getAll('stageName'),starts=d.getAll('stageStart'),kinds=d.getAll('stageKind'),shapes=d.getAll('stageShape'),colors=d.getAll('stageColor'),accessories=d.getAll('stageAccessory');
   const stages=names.map((name,i)=>({name,start:Number(starts[i]),kind:kinds[i],shape:shapes[i],color:colors[i],accessory:accessories[i]}));
   await mutate('pet.settings',{name:d.get('name'),petKind:state.pet.kind,color:state.pet.color,stages});close();toast('宠物形象与成长阶段已同步 ♡');
 });
 const list=$('#pet-stage-list'),active=$('#active-form');
 const preview=()=>{list.querySelectorAll('[data-stage-row]').forEach((el,i)=>{el.querySelector('legend').textContent='成长阶段 '+(i+1);const get=name=>el.querySelector(`[name="${name}"]`).value;const look={name:get('stageName'),start:0,kind:get('stageKind'),shape:get('stageShape'),color:get('stageColor'),accessory:get('stageAccessory')};el.querySelector('.pet-stage-preview').innerHTML=LittleDaysPetView.art({...state.pet,name:active.elements.namedItem('name').value,xp:0,stages:[look]});el.querySelector('[data-remove-stage]').disabled=list.children.length<=2;});$('#add-pet-stage').disabled=list.children.length>=5};
 active.addEventListener('input',preview);active.addEventListener('change',preview);
 list.addEventListener('click',e=>{const button=e.target.closest('[data-remove-stage]');if(button&&list.children.length>2){button.closest('[data-stage-row]').remove();preview()}});
 $('#add-pet-stage').onclick=()=>{if(list.children.length>=5)return;const last=list.lastElementChild;const next=Math.min(100000000,Number(last.querySelector('[name="stageStart"]').value||0)+200);list.insertAdjacentHTML('beforeend',row({name:'新阶段',start:next,kind:'cat',shape:'grown',color:'#e9c49a',accessory:'default'},list.children.length));preview()};preview();
};
$('#care-history').onclick=()=>{const logs=state.pet.careLog;modal('两个人的照顾日记',logs.length?logs.map(l=>`<div class="care-log">♡ ${esc(l.actor)}${careWords[l.action]}<small>${new Date(l.at).toLocaleString('zh-CN')} · 一点点陪伴，一起长大</small></div>`).join(''):'<p class="pet-help">还没有照顾记录。第一份小零食，第一下摸摸，都值得记下来。</p>')};
document.querySelectorAll('[data-care]').forEach(b=>b.onclick=async()=>{if(!needReady()||petCareBusy)return;petCareBusy=true;renderPet();try{await mutate('pet.care',{action:b.dataset.care});toast(b.dataset.care==='sleep'?'盖好小被子，让它安心睡一会儿 ♡':`${state.pet.name}收到了你的小小心意 ♡`)}catch(e){toast(e.message)}finally{petCareBusy=false;renderPet()}});
function editSettings(){if(!needReady())return;modal('布置我们的小屋');form(field(roleLabel(1)+'的名字','name1','text',state.names[0],'required maxlength="15"')+field(roleLabel(2)+'的名字','name2','text',state.names[1],'required maxlength="15"')+field('在一起的第一天','start','date',state.start,`max="${today()}"`)+field('首页的一句话','intro','text',state.intro,'maxlength="100" placeholder="一起吃过的饭、看过的落日……"')+'<p class="form-help">这些内容会同步到你们的云端小屋。两人各自的心情，会分开记录。</p>',async d=>{await mutate('settings',{names:[d.get('name1'),d.get('name2')],start:d.get('start'),intro:d.get('intro')});close();toast('小屋更像你们的家了 ♡')});const div=document.createElement('div');div.className='backup-actions';div.innerHTML='<button class="outline" id="export">导出可读回忆 ↓</button><button class="outline" id="full-backup">下载完整备份 ↓</button><button class="outline" id="import">导入回忆 ↑</button><button class="outline" id="show-account">双人设置 ↗</button>';$('#modal-content').append(div);$('#export').onclick=exportData;$('#full-backup').onclick=fullBackupInfo;$('#import').onclick=importData;$('#show-account').onclick=()=>{if(requestModalClose())accountInfo()};if(STANDALONE_MODE)window.LittleDaysEntry?.attachSettings()}
$('#settings').onclick=editSettings;$('#edit-names').onclick=editSettings;
function accountInfo(){modal('两个人，一个小小的家',`<p class="form-help">各自选择自己的身份、输入密码，就能回到同一个小屋。当前身份：${esc(roleLabel(me?.slot))}。</p><div class="account-card">${esc(state.names[0])} & ${esc(state.names[1])}<span>照片、留言、心情和宠物成长，共同保存在云端。</span></div><p class="form-help">换设备时，用同一个身份和密码登录即可。忘记密码可使用提前保存的个人恢复码；也可以请管理员在小屋设置中重设。</p><p class="form-help">小屋约每 12 秒自动同步一次；返回页面时也会同步。</p><div class="backup-actions">${me?.canManagePasswords?'<button class="outline" id="manage-passwords">密码与恢复码 ♡</button>':STANDALONE_MODE?'<p class="form-help">请管理员登录后设置密码和恢复码。</p>':`<a class="outline" href="${ownerSignIn}" target="_top">管理员设置密码 ↗</a>`}</div><div class="backup-actions"><button class="outline" id="account-backup">下载完整备份 ↓</button></div><div class="account-links"><button id="copy-home" class="text-button">复制小屋链接 ↗</button><button id="home-logout" class="text-button">退出小屋</button></div>`);$('#account-backup').onclick=fullBackupInfo;$('#copy-home').onclick=async()=>{try{await navigator.clipboard.writeText(new URL('./',location.href).href);toast('链接已复制，告诉对方对应的身份和密码即可')}catch{toast('请复制浏览器地址栏里的小屋链接')}};if($('#manage-passwords'))$('#manage-passwords').onclick=()=>{close();managePasswords()};$('#home-logout').onclick=async()=>{try{await api('/api/auth',{method:'DELETE'});forgetDevice();if(me?.loginMethod==='chatgpt'){location.href='/signout-with-chatgpt?return_to=%2F'}else location.reload()}catch(e){toast(e.message)}}}$('#account-info').onclick=accountInfo;
async function managePasswords(){if(!me?.canManagePasswords)return;modal('为两个人设置小屋密码','<p class="form-help">正在打开密码设置……</p>');try{const data=await api('/api/passwords');$('#modal-content').innerHTML='<p class="form-help">独属于我们的密码，打开我们的日常。为两个人分别设置密码，回家时选择自己的身份即可。</p>'+[1,2].map(slot=>`<div class="key-person"><div><strong>${esc(roleLabel(slot))} · ${esc(state.names[slot-1])}${slot===me.slot?'（我）':''}</strong><small>${data.passwords.some(x=>x.slot===slot)?'已经设置登录密码':'还没有设置密码'}</small></div><button class="outline" data-set-password="${slot}">${data.passwords.some(x=>x.slot===slot)?'修改密码':'设置密码'} ↗</button><button class="text-button" data-recovery-slot="${slot}">生成 / 更换 12 位恢复码</button></div>`).join('')+'<p class="form-help">恢复码只显示一次，每次使用后会更新，请各自私下保存。修改密码会退出对应身份之前的登录，回忆和宠物都会保留。</p>';document.querySelectorAll('[data-set-password]').forEach(b=>b.onclick=()=>passwordForm(Number(b.dataset.setPassword)));document.querySelectorAll('[data-recovery-slot]').forEach(b=>b.onclick=()=>generateRecoveryCode(Number(b.dataset.recoverySlot)))}catch(e){$('#modal-content').textContent=e.message}}
function passwordForm(slot){close();modal(roleLabel(slot)+' · '+state.names[slot-1]+'的密码');form(field('新的登录密码','password','password','','required minlength="6" maxlength="128" autocomplete="new-password"')+field('再输入一次','confirmation','password','','required minlength="6" maxlength="128" autocomplete="new-password"')+'<p class="form-help">至少 6 个字符。修改后，对应身份之前的登录会退出；回忆和宠物继续保留。</p>',async d=>{if(d.get('password')!==d.get('confirmation'))throw new Error('两次密码不一样，请再确认一下。');await api('/api/passwords',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({slot,password:d.get('password')})});$('#active-form').reset();close();if(STANDALONE_MODE&&slot===me.slot)showLogin('密码已修改，请使用新密码重新登录。');else toast(roleLabel(slot)+'的密码已设置好 ♡')});$('#active-form button[type="submit"]').textContent='保存密码 ♡'}
$('#key-login-form').onsubmit=async e=>{e.preventDefault();const button=$('#key-login-button');button.disabled=true;$('#login-note').textContent='正在为你打开小屋……';showConnectionRetry(false);try{const login=await api('/api/auth',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({slot:Number($('#login-slot').value),password:$('#home-password').value,remember:$('#remember-device').checked})});loginRequired=false;if(PAGES_MODE){if(!login.token)throw new Error('登录通道尚未准备好，请稍后重试。');pagesToken=login.token;if($('#remember-device').checked){try{localStorage.setItem(DEVICE_KEY,JSON.stringify({token:login.token,expiresAt:login.expiresAt}))}catch{toast('此浏览器无法记住登录，当前页面仍可使用。')}}else try{localStorage.removeItem(DEVICE_KEY)}catch{}}$('#home-password').value='';await refreshNow();toast('欢迎回家 ♡')}catch(err){$('#login-note').textContent=err.message;showConnectionRetry(!!err.connection)}finally{button.disabled=false}};
$('#password-visibility').onclick=()=>{const input=$('#home-password'),shown=input.type==='password';input.type=shown?'text':'password';$('#password-visibility').textContent=shown?'隐藏':'显示';$('#password-visibility').setAttribute('aria-pressed',String(shown))};
$('#add-story').onclick=()=>{if(!needReady())return;modal('记下一个心动瞬间');form(field('这一天','date','date',today(),'required')+field('给回忆起个名字','title','text','','required maxlength="40" placeholder="第一次一起看海"')+'<label class="form-field">想记住的细节<textarea name="text" maxlength="1500" required placeholder="那天的天气、对方说的话，还有你的心情……"></textarea></label>',async d=>{await mutate('story.add',{...Object.fromEntries(d),id:uid()});close();toast('一段回忆，已经为两个人收藏好了')},'story')};
$('#add-anniversary').onclick=()=>{if(!needReady())return;modal('添加一个值得期待的日子');form(field('纪念日名称','title','text','','required maxlength="30" placeholder="你的生日 / 第一次牵手"')+field('日期（每年提醒）','date','date',today(),'required'),async d=>{await mutate('anniversary.add',{...Object.fromEntries(d),id:uid()});close();toast('重要的日子，记住了 ♡')})};
document.querySelectorAll('[data-mood]').forEach(b=>b.onclick=async()=>{if(!needReady())return;try{await mutate('mood',{mood:b.dataset.mood});toast('今天的心情，对方也能看到啦')}catch(e){toast(e.message)}});
$('#random-date').onclick=()=>{if(!needReady())return;location.hash='/together'};
$('#wish-form').onsubmit=async e=>{e.preventDefault();if(!needReady())return;const text=$('#wish-input').value.trim();if(!text)return;const btn=e.submitter;btn.disabled=true;try{await mutate('wish.add',{id:uid(),text});$('#wish-input').value='';toast('又多了一个一起期待的以后')}catch(err){toast(err.message)}finally{btn.disabled=false}};
$('#add-letter').onclick=()=>{if(!needReady())return;modal('写给最喜欢的那个人');form(field('署名','author','text',state.names[(me?.slot||1)-1],'required maxlength="20"')+'<label class="form-field">想说的话<textarea name="text" required maxlength="3000" placeholder="亲爱的，今天想对你说……"></textarea></label>'+field('约定打开日期（可选）','openDate','date','',`min="${today()}"`)+'<p class="form-help">未来信的正文会在云端收好，到了约定日期再一起打开。日期按北京时间计算。</p>',async d=>{await mutate('letter.add',{...Object.fromEntries(d),id:uid()});close();toast('你的心意，已经在小屋里收好了 ♡')},'letter')};
async function extractPhotoMeta(file, now = Date.now()) {
  let takenAt = now, lat = null, lng = null;
  const type = String(file?.type || '').toLowerCase();
  const canReadExif = /^image\/(jpeg|heic|heif|tiff)$/.test(type);
  const exifr = globalThis.exifr;
  let exifData = null;

  if (canReadExif && exifr && typeof exifr.parse === 'function') {
    try {
      exifData = await exifr.parse(file, { gps: true, exif: true, tiff: true });

      if (exifData && typeof exifData === 'object') {
        const dateVal = exifData.DateTimeOriginal;
        if (dateVal) {
          const parsed = dateVal instanceof Date ? dateVal.getTime() : Date.parse(String(dateVal));
          if (Number.isFinite(parsed) && parsed > 0 && parsed <= now + 86400000) {
            takenAt = parsed;
          }
        }

        const parseCoordinate = (value, ref) => {
          if (value === null || value === undefined || value === '') return null;
          const number = part => {
            if (typeof part === 'number') return part;
            if (Array.isArray(part) && part.length === 2) return Number(part[0]) / Number(part[1]);
            if (part && typeof part === 'object' && 'numerator' in part) return Number(part.numerator) / Number(part.denominator);
            return Number(part);
          };
          let degrees;
          if (Array.isArray(value) && value.length >= 3) {
            const [d, m, s] = value.slice(0, 3).map(number);
            if (![d, m, s].every(Number.isFinite)) return null;
            degrees = d + m / 60 + s / 3600;
          } else {
            degrees = number(value);
          }
          if (!Number.isFinite(degrees)) return null;
          if (/^[SW]$/i.test(String(ref || ''))) degrees = -Math.abs(degrees);
          if (/^[NE]$/i.test(String(ref || ''))) degrees = Math.abs(degrees);
          return degrees;
        };

        lat = parseCoordinate(exifData.latitude ?? exifData.GPSLatitude, exifData.GPSLatitudeRef);
        lng = parseCoordinate(exifData.longitude ?? exifData.GPSLongitude, exifData.GPSLongitudeRef);
        if (lat < -90 || lat > 90) lat = null;
        if (lng < -180 || lng > 180) lng = null;
      }
    } catch (e) {
      console.warn('读取照片 EXIF 失败:', e);
    }
  }

  console.log('完整EXIF:', exifData);
  console.log('提取到的元数据:', { takenAt, lat, lng });
  return { takenAt, lat, lng };
}
async function uploadPhoto(blob,caption,merge=true,onProgress=()=>{},createdAt,takenAt,latitude,longitude,locationName){
 const payload=new FormData();
payload.append('photo',blob,'memory.jpg');
payload.append('caption',caption);
payload.append('merge','1');
if(createdAt!==undefined) payload.append('created_at',String(createdAt));
if(takenAt!==undefined) payload.append('taken_at',new Date(takenAt).toISOString());
if(latitude!==undefined&&latitude!==null&&longitude!==undefined&&longitude!==null){
 payload.append('latitude',String(latitude));
 payload.append('longitude',String(longitude));
}
if(locationName)payload.append('location_name',String(locationName));
 const send=()=>new Promise((resolve,reject)=>{const xhr=new XMLHttpRequest();xhr.open('POST',API_ORIGIN+'/api/photos');xhr.timeout=60000;xhr.withCredentials=!PAGES_MODE;if(PAGES_MODE&&pagesToken)xhr.setRequestHeader('Authorization','Bearer '+pagesToken);xhr.upload.onprogress=e=>{if(e.lengthComputable)onProgress(Math.min(99,Math.round(e.loaded/e.total*100)))};xhr.onerror=()=>reject(new Error('网络中断，照片尚未确认保存。'));xhr.ontimeout=()=>reject(new Error('上传超时，照片尚未确认保存。'));xhr.onload=()=>{let result;try{result=JSON.parse(xhr.responseText)}catch{return reject(new Error('上传入口暂时不可用，请稍后重试。'))}if(xhr.status>=200&&xhr.status<300){onProgress(100);resolve(result)}else{const err=new Error(result.error||'照片没有上传成功。');err.status=xhr.status;if(xhr.status===401)showLogin(err.message);reject(err)}};console.log('发送的 payload:',Array.from(payload.entries()));xhr.send(payload)});
 try{return await send()}catch(e){if(e.status)throw e;onProgress(0);return send()}
}
function addPhoto(){
 if(!needReady())return;modal('把照片收藏进相册');
 const places=[['shanghai','上海',31.2304,121.4737],['beijing','北京',39.9042,116.4074],['hangzhou','杭州',30.2741,120.1551],['chengdu','成都',30.5728,104.0668],['guangzhou','广州',23.1291,113.2644],['shenzhen','深圳',22.5431,114.0579],['nanjing','南京',32.0603,118.7969],['wuhan','武汉',30.5928,114.3055],['xian','西安',34.3416,108.9398],['hongkong','香港',22.3193,114.1694],['tokyo','东京',35.6762,139.6503],['paris','巴黎',48.8566,2.3522],['new-york','纽约',40.7128,-74.006]];
 form(field('选择照片（一次最多 20 张）','photo','file','','required multiple accept="image/*"')+'<img id="photo-preview" class="upload-preview" alt="第一张待上传的照片预览" hidden>'+field('给这组照片写一句话','caption','text','','maxlength="80" placeholder="和你一起看过的第一个日落"')+`<label class="form-field">手动定位（可选，可覆盖照片 GPS）<select name="manual_location"><option value="">使用照片自动提取的 GPS</option>${places.map(place=>`<option value="${place[0]}">${esc(place[1])}</option>`).join('')}</select></label><p class="form-help">手动地点会应用于本次选择的所有照片；不选则保留每张照片自动提取的位置。当前支持常用城市。</p>`+'<p class="form-help">相册可收藏 5,000 张，每次可多选 20 张，单张原图不超过 20 MB。会自动压缩，逐张保存；失败后重试会跳过已保存的照片。</p><progress id="upload-progress" max="100" value="0" hidden></progress><p class="form-help" id="upload-status" role="status"></p>',async d=>{
  const files=Array.from($('#active-form input[name="photo"]')?.files||[]).filter(f=>f.size),progress=$('#upload-progress'),note=$('#upload-status');if(!files.length)throw Error('请先选择照片。');if(files.length>20)throw Error('一次最多选择 20 张，可以分批继续添加。');if(files.some(f=>f.size>20*1024*1024))throw Error('有照片超过 20 MB，请选择小一些的原图。');
  const manualPlace=places.find(place=>place[0]===d.get('manual_location'));
  $('#modal').dataset.busy='1';progress.hidden=false;let saved=0;
  try{for(const [i,file]of files.entries()){note.textContent=`正在读取第 ${i+1} / ${files.length} 张的拍摄时间和地点……`;const meta=await extractPhotoMeta(file);note.textContent=`正在压缩第 ${i+1} / ${files.length} 张……`;const blob=await compressPhoto(file);await uploadPhoto(blob,d.get('caption'),true,n=>{progress.value=(i*100+n)/files.length;note.textContent=`正在上传第 ${i+1} / ${files.length} 张 · ${n}%`},undefined,meta.takenAt,manualPlace?.[2]??meta.lat,manualPlace?.[3]??meta.lng,manualPlace?.[1]);saved++}
   albumMonth='';if(typeof resetAlbumTimeline==='function')resetAlbumTimeline();await refreshNow();$('#modal').dataset.busy='0';close();toast(`${files.length} 张回忆已收藏 ♡`)
  }catch(e){note.textContent=`已处理 ${saved} / ${files.length} 张。${e.message} 点击重新上传可继续，不会重复保存。`;$('#active-form button[type="submit"]').textContent='重新上传 ↻';try{await refreshNow()}catch{}throw e}finally{$('#modal').dataset.busy='0'}
 });
 let preview='';$('#active-form input[name="photo"]').onchange=e=>{if(preview)URL.revokeObjectURL(preview);const files=Array.from(e.target.files||[]);$('#photo-preview').hidden=!files.length;if(files.length){preview=URL.createObjectURL(files[0]);$('#photo-preview').src=preview}$('#upload-status').textContent=files.length?'已选择 '+files.length+' 张照片，可继续更换选择。':''};$('#modal').addEventListener('close',()=>{if(preview)URL.revokeObjectURL(preview)},{once:true});
}
$('#add-photo').onclick=addPhoto;
function putVideo(url,file,onProgress){return new Promise((resolve,reject)=>{const xhr=new XMLHttpRequest();xhr.open('PUT',url);xhr.timeout=20*60*1000;xhr.setRequestHeader('Content-Type',file.type);xhr.upload.onprogress=e=>{if(e.lengthComputable)onProgress(Math.round(e.loaded/e.total*100))};xhr.onerror=()=>reject(new Error('视频上传连接中断。'));xhr.ontimeout=()=>reject(new Error('视频上传超时。'));xhr.onload=()=>xhr.status>=200&&xhr.status<300?resolve():reject(new Error('R2 没有接受这段视频。'));xhr.send(file)})}
function addVideo(){if(!needReady()||!me?.videoEnabled)return toast('视频存储尚未配置。');modal('收藏一段共同视频');form(field('选择视频','video','file','','required accept="video/mp4,video/webm,video/quicktime"')+field('写一句备注','caption','text','','maxlength="80" placeholder="我们的一段回忆"')+'<p class="form-help">支持 MP4、WebM、MOV，单个不超过 500 MB。文件会从浏览器直接传到私有 R2，不经过网站服务器；小屋里的两位成员都可以查看。</p><progress id="video-progress" max="100" value="0" hidden></progress><p id="video-status" class="form-help" role="status"></p>',async d=>{const file=d.get('video'),note=$('#video-status'),progress=$('#video-progress');if(!(file instanceof File)||!['video/mp4','video/webm','video/quicktime'].includes(file.type)||file.size<1||file.size>500*1024*1024)throw new Error('请选择 500 MB 以内的 MP4、WebM 或 MOV 视频。');let ticket;$('#modal').dataset.busy='1';progress.hidden=false;try{note.textContent='正在申请上传地址……';ticket=await api('/api/videos/presign',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({contentType:file.type,sizeBytes:file.size,caption:d.get('caption')})});await putVideo(ticket.uploadUrl,file,n=>{progress.value=n;note.textContent=`正在直接上传到 R2 · ${n}%`});note.textContent='正在核对视频……';await api('/api/videos/'+encodeURIComponent(ticket.id)+'/complete',{method:'POST'});await refreshNow();$('#modal').dataset.busy='0';close();toast('共同视频已保存 ♡')}catch(error){if(ticket?.id)try{await api('/api/videos/'+encodeURIComponent(ticket.id),{method:'DELETE'})}catch{}throw error}finally{$('#modal').dataset.busy='0'}});$('#active-form button[type="submit"]').textContent='直接上传到 R2 ♡'}
videoButton.onclick=addVideo;
async function viewVideo(id){if(!needReady())return;try{const result=await api('/api/videos/'+encodeURIComponent(id)+'/url');modal('共同视频',`<video class="video-player" controls autoplay playsinline src="${esc(result.url)}"></video><p class="form-help">播放地址约 2 分钟后失效，已开始的播放不受影响。</p>`)}catch(error){toast(error.message)}}
document.addEventListener('click',async e=>{const b=e.target.closest('button');if(!b||(!b.dataset.viewVideo&&!b.dataset.removeVideo))return;e.preventDefault();e.stopImmediatePropagation();if(b.dataset.viewVideo)return viewVideo(b.dataset.viewVideo);if(!needReady()||!confirm('确定从共同相册移除这段视频吗？'))return;b.disabled=true;try{await api('/api/videos/'+encodeURIComponent(b.dataset.removeVideo),{method:'DELETE'});await refreshNow();toast('视频已移除')}catch(error){toast(error.message)}finally{b.disabled=false}},true);
document.addEventListener('click',async e=>{const b=e.target.closest('button');if(!b)return;if(b.hasAttribute('data-upload'))return addPhoto();if(b.dataset.viewPhoto)return viewPhoto(b.dataset.viewPhoto);if(b.dataset.editPhotoDate)return editPhotoDate(b.dataset.editPhotoDate);if(b.dataset.addPhotoCaption)return addPhotoCaption(b.dataset.addPhotoCaption);if(b.dataset.removePhoto){if(!needReady()||!confirm('确定要移除这张照片吗？'))return;b.disabled=true;try{await api('/api/photos/'+encodeURIComponent(b.dataset.removePhoto),{method:'DELETE'});await refreshNow();toast('照片已移除')}catch(err){toast(err.message)}finally{b.disabled=false}return}if(b.dataset.toggleWish){if(!needReady())return;const w=state.wishes.find(x=>x.id===b.dataset.toggleWish);b.disabled=true;try{await mutate('wish.toggle',{id:w.id,done:!w.done})}catch(err){toast(err.message)}finally{b.disabled=false}return}for(const[attr,kind]of [['removeStory','story.remove'],['removeWish','wish.remove'],['removeLetter','letter.remove'],['removeAnniversary','anniversary.remove']])if(b.dataset[attr]){if(!needReady())return;const id=b.dataset[attr];modal('把这条记录收走吗？','<p class="form-help">移除会同步到两台设备，无法直接撤销。重要的回忆可以先导出保存。</p><div class="form-actions"><button class="outline" id="keep-item">留下它</button><button class="primary" id="confirm-remove">确认移除</button></div>');$('#keep-item').onclick=close;$('#confirm-remove').onclick=async e=>{e.target.disabled=true;try{await mutate(kind,{id});close();toast('已同步移除')}catch(err){toast(err.message);e.target.disabled=false}};break}});
async function blobData(blob){return new Promise((ok,fail)=>{const r=new FileReader();r.onload=()=>ok(r.result);r.onerror=fail;r.readAsDataURL(blob)})}
function fullBackupInfo(){
 if(!needReady()||!requestModalClose())return;
 if(!me?.canManagePasswords){modal('下载完整备份',STANDALONE_MODE?'<p class="form-help">完整备份由管理员下载，包含全部记录、照片和宠物状态。请管理员使用自己的密码登录后下载。</p>':`<p class="form-help">完整备份由管理员下载，包含全部记录、照片和宠物状态。请管理员进入原站后操作。</p><a class="primary" href="${ownerSignIn}" target="_top">我是管理员 →</a>`);return}
 modal('把我们的小日子，好好收藏','<p class="form-help">将全部回忆、纪念日、心愿、心情、宠物状态和云端照片保存为一个 JSON 文件。照片包含在文件中，不是失效后无法打开的网址。</p><p class="form-help"><strong>也包含未到期未来信的原文和未揭晓的双人问答。</strong>完整备份仅由管理员下载。备份文件可以直接阅读，请保存在自己的设备或私人网盘，不要公开分享。登录密码与会话凭证不会导出。</p><p class="form-help">整理期间请保持页面打开，照片较多时需要等待。超过 1GB 的文件当前无法通过网页导入，请联系部署者使用服务器快照或云端备份。下载后可通过「导入回忆」合并文字和照片；选择备份文件后，可预览并选择合并回忆，或由管理员恢复文字、心情和宠物状态。照片始终合并保留。</p><button class="primary" id="download-full-backup">下载完整备份 ↓</button><p class="form-help" id="backup-progress" role="status" aria-live="polite"></p>');
 $('#download-full-backup').onclick=downloadFullBackup;
}
async function downloadFullBackup(){
 const button=$('#download-full-backup'),progress=$('#backup-progress');button.disabled=true;$('#close-modal').disabled=true;$('#modal').dataset.busy='1';
 try{
  progress.textContent='正在读取云端记录……';await queue;
  const snapshot=await api('/api/backup');const backup=structuredClone(snapshot.state),photos=backup.photos;backup.photos=[];
  backup.backup={format:'little-days-full-backup',version:1,exportedAt:snapshot.exportedAt,revision:snapshot.revision,updatedAt:snapshot.updatedAt,photoCount:photos.length,containsSealedLetters:true,photoChecksums:{},restoreMode:'preview-merge-or-restore-with-pet'};
  for(let i=0;i<photos.length;i++){
   const p=photos[i];progress.textContent=`正在整理照片 ${i+1} / ${photos.length}……`;
   const response=await backendFetch('/api/photos/'+encodeURIComponent(p.id),{cache:'no-store',signal:AbortSignal.timeout(60000)});
   if(!response.ok||!/^image\/jpeg(?:\s*;|$)/i.test(response.headers.get('content-type')||''))throw new Error('有照片未能完整下载，本次未生成备份。请稍后重试。');
   const blob=await response.blob();if(!blob.size)throw new Error('照片内容为空，本次未生成备份。请重试。');const bytes=new Uint8Array(await blob.arrayBuffer());if(bytes.length<3||bytes[0]!==255||bytes[1]!==216||bytes[2]!==255)throw new Error('照片格式不正确，本次未生成备份。请检查照片后重试。');
   backup.backup.photoChecksums[p.id]=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),x=>x.toString(16).padStart(2,'0')).join('');
   backup.photos.push({...p,data:await blobData(new Blob([blob],{type:'image/jpeg'}))});
  }
  progress.textContent='正在生成备份文件……';
  const file=new Blob([JSON.stringify(backup,null,2)],{type:'application/json'}),tooLarge=file.size>1024*1024*1024,url=URL.createObjectURL(file),a=document.createElement('a');a.href=url;a.download=`我们的小日子-完整备份-${today()}.json`;document.body.append(a);a.click();a.remove();const download=document.createElement('a');download.href=url;download.download=a.download;download.className='outline';download.textContent='未弹出下载？点此保存文件 ↓';progress.after(download);const confirmed=document.createElement('button');confirmed.className='text-button';confirmed.textContent='我已确认文件保存成功 ✓';download.after(confirmed);confirmed.onclick=()=>{try{localStorage.setItem('little-days-last-backup',JSON.stringify({at:Date.now(),revision:snapshot.revision,photos:photos.length,records:backupRecordCount(backup)}))}catch{}renderBackupReminder();confirmed.disabled=true;confirmed.textContent='已记录本设备备份时间 ✓'};if(navigator.canShare&&typeof File!=='undefined'){const mobileFile=new File([file],a.download,{type:'application/json'});if(navigator.canShare({files:[mobileFile]})){const share=document.createElement('button');share.className='text-button';share.textContent='保存到手机文件或网盘 ↗';download.after(share);share.onclick=()=>navigator.share({files:[mobileFile]}).catch(()=>{})}}$('#modal').addEventListener('close',()=>URL.revokeObjectURL(url),{once:true});
  progress.textContent=`已发起下载：${photos.length} 张照片及全部记录。请在浏览器下载列表中确认文件已保存。`+(tooLarge?' 备份超过 1GB，网页暂时不能导入，请联系部署者使用服务器快照或云端备份。':'');toast(tooLarge?'备份超过 1GB，网页暂时不能导入。':'完整备份已生成，请确认下载保存成功 ♡');
 }catch(e){progress.textContent=e.message||'备份没有完成，请重试。'}finally{button.disabled=false;$('#close-modal').disabled=false;$('#modal').dataset.busy='0'}
}
async function exportData(){
 if(!needReady()||$('#modal').dataset.busy==='1')return;
 const button=$('#export'),dialog=$('#modal');button.disabled=true;dialog.dataset.busy='1';
 let note=$('#export-result');if(!note){note=document.createElement('div');note.id='export-result';note.className='export-result';note.setAttribute('role','status');$('#modal-content').append(note)}
 note.textContent='正在整理回忆与照片，请稍候……';
 try{
  await queue;const backup=structuredClone(state),photos=backup.photos;backup.photos=[];backup.letters=backup.letters.filter(l=>!l.locked);backup.note='未到约定日期的未来信仍保留云端，未包含在此导出中。导入会合并回忆，不会覆盖云端现有内容。';
  for(let i=0;i<photos.length;i++){
   const p=photos[i];note.textContent=`正在整理照片 ${i+1} / ${photos.length}……`;
   const res=await backendFetch('/api/photos/'+encodeURIComponent(p.id),{cache:'no-store',signal:AbortSignal.timeout(60000)});
   if(!res.ok||!/^image\/jpeg(?:\s*;|$)/i.test(res.headers.get('content-type')||''))throw new Error('部分照片未能完整下载，本次没有生成回忆文件，请稍后重试。');
   const blob=await res.blob();if(!blob.size)throw new Error('照片内容为空，本次没有生成回忆文件，请稍后重试。');const head=new Uint8Array(await blob.slice(0,3).arrayBuffer());if(head.length<3||head[0]!==255||head[1]!==216||head[2]!==255)throw new Error('照片格式不正确，本次没有生成回忆文件。请检查照片后重试。');
   backup.photos.push({...p,data:await blobData(new Blob([blob],{type:'image/jpeg'}))});
  }
  const link=document.createElement('a'),url=URL.createObjectURL(new Blob([JSON.stringify(backup,null,2)],{type:'application/json'}));
  link.href=url;link.download=`我们的小日子-回忆-${today()}.json`;link.className='outline';link.textContent='点击保存回忆文件 ↓';
  note.textContent='回忆文件已生成，请在下载列表中确认保存成功。未到期的未来信继续留在云端。';note.append(link);link.click();
  dialog.addEventListener('close',()=>URL.revokeObjectURL(url),{once:true});
 }catch(error){note.textContent=error.message||'导出没有完成，请稍后重试。'}finally{button.disabled=false;dialog.dataset.busy='0'}
}

let legacy=null;try{legacy=JSON.parse(localStorage.getItem(OLD_KEY)||'null')}catch{}
function checkMigration(){let dismissed=false;try{dismissed=!!localStorage.getItem('little-days-migrated')}catch{}$('#migration-banner').hidden=!(ready&&legacy&&!dismissed&&(legacy.start||legacy.stories?.length||legacy.photos?.length||legacy.letters?.length||legacy.wishes?.length))}
async function restorePhotoCaptions(photo,photoId){for(const item of Array.isArray(photo.captions)?photo.captions:[]){if(!item||item.original||typeof item.text!=='string'||!item.text.trim()||item.text.trim().length>500)continue;await api('/api/photos/'+encodeURIComponent(photoId)+'/caption',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id:item.id,text:item.text,createdAt:item.createdAt})})}}
async function mergeBackup(data,isLegacy=false){if(![1,2].includes(data?.v)||!Array.isArray(data.names)||!Array.isArray(data.photos)||data.photos.length>5000)throw new Error('这份文件不是有效的小屋备份。');const btn=$('#confirm-import');btn.disabled=true;btn.textContent='正在搬回忆…';try{await mutate('import',{data:{...data,photos:[]}});let n=0;for(const p of data.photos){if(!p.data||!/^data:image\/jpeg(?:;[^,;]+)*;base64,[A-Za-z0-9+/=]+$/i.test(p.data))continue;const blob=await(await fetch(p.data)).blob();if(blob.size>4*1024*1024)continue;const result=await uploadPhoto(new Blob([blob],{type:'image/jpeg'}),p.caption||'',true,()=>{},p.created_at,p.taken_at,p.latitude,p.longitude,p.location_name);await restorePhotoCaptions(p,result.id);if(!result.existed)n++}if(isLegacy)try{localStorage.setItem('little-days-migrated','1')}catch{}await refreshNow();checkMigration();close();toast(`回忆已经合并进云端${n?`，带来了 ${n} 张照片`:''} ♡`)}catch(e){btn.disabled=false;btn.textContent='继续搬回忆';throw e}}
function importConfirm(data,isLegacy=false){
if(![1,2].includes(data?.v)||!Array.isArray(data.names)||!Array.isArray(data.photos)||data.photos.length>5000||!['stories','wishes','letters','anniversaries'].every(k=>Array.isArray(data[k]))){toast('备份内容不完整，请选择有效文件。');return}
 const previewRevision=revision;modal('先看看，要带回哪些回忆',`<div class="account-card">${esc(data.names.join(' & '))}<span>故事 ${data.stories.length} · 留言 ${data.letters.length} · 心愿 ${data.wishes.length} · 纪念日 ${data.anniversaries.length} · 照片 ${data.photos.length}</span><span>心情 ${Object.keys(data.moods||{}).length} 天 · 问答 ${Object.keys(data.daily||{}).length} 天 · 灵感 ${data.dateIdeas?.length||0} · 日程 ${data.calendar?.length||0} · 小券 ${data.coupons?.length||0} · 宠物 ${esc(data.pet?.name||'未包含')} · 成长值 ${Number(data.pet?.xp)||0}</span></div><p class="form-help">默认合并回忆，保留云端已有记录与宠物。普通成员只合并自己的答案和档案；请管理员导入完整双人备份。照片始终合并，不删除现有照片。失败后可重试，已导入的内容会跳过。</p>${me?.canManagePasswords&&data.v===2&&data.pet&&!isLegacy?'<label class="form-field">恢复方式<select id="restore-mode"><option value="merge">合并回忆，保留现在的宠物</option><option value="restore">恢复备份的文字、设置、心情和宠物</option></select></label><p class="form-help">恢复会替换当前文字、名字、心情和宠物（包括成长值）。建议先下载当前完整备份。照片不会删除；登录密码与恢复码不变。</p><label class="form-field" id="restore-confirm-label" hidden>确认恢复，请输入“恢复小屋”<input id="restore-confirm" autocomplete="off"></label>':''}<p id="restore-progress" class="form-help" role="status"></p><div class="form-actions"><button class="outline" id="cancel-import">取消</button><button class="primary" id="confirm-import">带回我们的小屋</button></div>`);
 if($('#restore-mode'))$('#restore-mode').onchange=()=>{$('#restore-confirm-label').hidden=$('#restore-mode').value!=='restore'};
 $('#cancel-import').onclick=close;$('#confirm-import').onclick=async()=>{const btn=$('#confirm-import'),note=$('#restore-progress'),restore=$('#restore-mode')?.value==='restore';if(restore&&$('#restore-confirm').value!=='恢复小屋'){note.textContent='请先输入“恢复小屋”确认。';return}btn.disabled=true;$('#modal').dataset.busy='1';try{
 note.textContent='正在校验备份与照片……';for(const p of data.photos){if(p.created_at!==undefined&&(!Number.isSafeInteger(p.created_at)||p.created_at<=0||p.created_at>Date.now()))throw new Error('备份中的照片日期无效，尚未开始恢复。');if(typeof p.data!=='string'||!/^data:image\/jpeg(?:;[^,;]+)*;base64,[A-Za-z0-9+/=]+$/i.test(p.data))throw new Error('备份中有照片数据缺失，尚未开始恢复。');const blob=await(await fetch(p.data)).blob();if(!blob.size||blob.size>4*1024*1024)throw new Error('备份中有照片格式或大小不正确，尚未开始恢复。');const head=new Uint8Array(await blob.slice(0,3).arrayBuffer());if(head.length<3||head[0]!==255||head[1]!==216||head[2]!==255)throw new Error('备份中有照片格式不正确，尚未开始恢复。');const checksum=data.backup?.photoChecksums?.[p.id];if(checksum){const actual=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',await blob.arrayBuffer())),x=>x.toString(16).padStart(2,'0')).join('');if(actual!==checksum)throw new Error('照片校验失败，文件可能已损坏。尚未开始恢复。')}}
 if(restore&&revision!==previewRevision)throw new Error('预览后小屋已更新，请重新选择备份并预览。');
 const photoIds=new Map();for(let i=0;i<data.photos.length;i++){const p=data.photos[i];note.textContent=`正在合并照片 ${i+1} / ${data.photos.length}……`;let targetId=p.id;if(!state.photos.some(x=>x.id===p.id)){const blob=await(await fetch(p.data)).blob();const result=await uploadPhoto(new Blob([blob],{type:'image/jpeg'}),p.caption||'',true,()=>{},p.created_at,p.taken_at,p.latitude,p.longitude,p.location_name);targetId=result.id}photoIds.set(p.id,targetId);await restorePhotoCaptions(p,targetId)}const importedData={...data,dateIdeas:data.dateIdeas?.map(x=>({...x,photoId:x.photoId?(photoIds.get(x.photoId)||x.photoId):''}))};
 if(restore){note.textContent='正在恢复文字、心情和宠物……';const seq=++requestId;accept(await api('/api/restore',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({confirmation:'恢复小屋',expectedRevision:previewRevision,data:{...importedData,photos:[]}})}),seq)}else await mutate('import',{data:{...importedData,photos:[]}});
 if(isLegacy)try{localStorage.setItem('little-days-migrated','1')}catch{}await refreshNow();$('#modal').dataset.busy='0';close();toast(restore?'回忆、心情和宠物已恢复，照片已合并 ♡':'回忆已合并，宠物继续陪你们长大 ♡');
 }catch(e){note.textContent=e.message+' 已上传的照片会保留，重试不会重复导入。';btn.disabled=false}finally{$('#modal').dataset.busy='0'}};
}
function importData(){if(!requestModalClose())return;const input=document.createElement('input');input.type='file';input.accept='.json,application/json';input.onchange=async()=>{const f=input.files[0];if(!f)return;if(f.size>1024*1024*1024){toast('备份超过 1GB，当前浏览器无法导入。请保留文件并联系管理员迁移。');return}try{const data=JSON.parse(await f.text());if(![1,2].includes(data.v))throw new Error();importConfirm(data)}catch{toast('这份文件不是有效的小屋备份。')}};input.click()}
function backupRecordCount(data){return ['stories','letters','wishes','anniversaries','dateIdeas','calendar','coupons'].reduce((n,k)=>n+(data[k]?.length||0),0)+Object.keys(data.moods||{}).length+Object.keys(data.daily||{}).length}
function renderBackupReminder(){const el=$('#backup-reminder-text');if(!el)return;let last=null;try{last=JSON.parse(localStorage.getItem('little-days-last-backup')||'null')}catch{}const changes=last?Math.max(0,state.photos.length-last.photos)+Math.max(0,backupRecordCount(state)-last.records):0;el.textContent=!last?'还没有确认过备份，把珍贵的小日子多留一份吧。':`本设备上次确认备份：${new Date(last.at).toLocaleDateString('zh-CN')}${Date.now()-last.at>7*86400000||changes>=10?' · 最近又有了新回忆，记得更新备份 ♡':''}`}
$('#backup-reminder-button').onclick=fullBackupInfo;
$('#pet-duet').onclick=async()=>{if(!needReady())return;const button=$('#pet-duet');button.disabled=true;try{await mutate('pet.duet',{});toast(state.pet.duet?'邀请已送出，等另一位在 5 分钟内回应 ♡':'两份陪伴，小家伙都收到啦 ♡')}catch(e){toast(e.message)}finally{button.disabled=false}};
function recoveryDisplay(code){return /^[2-9A-HJ-NP-Z]{12}$/.test(code)?code.match(/.{4}/g).join("-"):code}
function recoveryResult(code,title='请收好新的恢复码'){
 code=recoveryDisplay(code);
 modal(title,`<p class="form-help">恢复码相当于这位成员的备用钥匙，只显示这一次，请私下保存。旧码已经失效；不要把它放进公开仓库或发到群里。</p><code class="recovery-code">${esc(code)}</code><div class="backup-actions"><button class="outline" id="copy-recovery">复制恢复码</button><button class="outline" id="save-recovery">下载到文件 ↓</button></div>`);
 $('#copy-recovery').onclick=async()=>{try{await navigator.clipboard.writeText(code);toast('恢复码已复制，请妥善保管')}catch{toast('请长按上方恢复码手动复制')}};
 $('#save-recovery').onclick=()=>{const a=document.createElement('a'),url=URL.createObjectURL(new Blob(['我们的小日子 · 个人恢复码\n'+code+'\n请私下保存，每次使用后换成新码。'],{type:'text/plain;charset=utf-8'}));a.href=url;a.download='小屋-个人恢复码.txt';document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),60000)};
}
async function generateRecoveryCode(slot){if(!confirm('生成新恢复码后，这位成员的旧恢复码会失效。请在显示后立即保存。'))return;try{const result=await api('/api/recovery',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({slot})});close();recoveryResult(result.code,roleLabel(slot)+'的个人恢复码')}catch(e){toast(e.message)}}
$('#forgot-password').onclick=()=>{
 modal('用个人恢复码找回密码');form(`<p class="form-help">输入对应身份提前保存的个人恢复码，即可设置新密码。新码为 12 位，大小写、空格和分隔线均可；旧的 64 位码仍可使用。未保存恢复码时，请联系管理员或部署者。</p><label class="form-field">你的身份<select name="slot"><option value="1">${esc(roleLabel(1))}</option><option value="2">${esc(roleLabel(2))}</option></select></label>`+field('个人恢复码','code','text','','required minlength="12" maxlength="128" autocomplete="off" autocapitalize="characters" spellcheck="false" placeholder="12 位恢复码，也支持旧的 64 位码"')+field('新的登录密码','password','password','','required minlength="6" maxlength="128" autocomplete="new-password"')+field('再输入一次','confirmation','password','','required minlength="6" maxlength="128" autocomplete="new-password"'),async d=>{if(d.get('password')!==d.get('confirmation'))throw new Error('两次密码不一致。');const result=await api('/api/recovery',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({slot:Number(d.get('slot')),code:d.get('code'),password:d.get('password')})});forgetDevice();close();recoveryResult(result.code,'密码已重设，请保存更新后的恢复码')});$('#active-form button[type="submit"]').textContent='重设密码并更新恢复码';
};
$('#migrate-local').onclick=()=>importConfirm(legacy,true);$('#sync-refresh').onclick=()=>sync(true);$('#retry-connection').onclick=async()=>{if(polling)return;if(STANDALONE_MODE&&window.LittleDaysEntry){await window.LittleDaysEntry.start();return;}loginRequired=false;nextSyncAt=0;$('#login-note').textContent='正在检查小屋连接……';showConnectionRetry(false);await sync(true)};document.addEventListener('visibilitychange',()=>{if(!document.hidden)sync(true)});window.addEventListener('online',()=>sync(true));window.addEventListener('offline',()=>{status('等待网络',true);connection('网络暂时断开。连上后会自动取回云端回忆。')});render();if(STANDALONE_MODE&&window.LittleDaysEntry)window.LittleDaysEntry.start();else sync();setInterval(()=>{if(!document.hidden)sync()},12000);
// Decorative only: preserve native clicks, form submission and keyboard activation.
document.addEventListener('click',event=>{
 const target=event.target instanceof Element?event.target.closest('button,a.primary,a.outline,.shortcut-links a,header nav a,.room-location a,.mobile-dock a,.room-menu a'):null;
 if(!target||target.matches(':disabled,[aria-disabled="true"]')||window.matchMedia('(prefers-reduced-motion: reduce)').matches)return;
 const rect=target.getBoundingClientRect();if(!rect.width||!rect.height)return;
 target.classList.add('tap-surface');target.querySelectorAll(':scope > .tap-ripple').forEach(wave=>wave.remove());
 const wave=document.createElement('span'),size=Math.min(420,Math.max(rect.width,rect.height)*1.8);wave.className='tap-ripple';wave.setAttribute('aria-hidden','true');
 wave.style.width=wave.style.height=size+'px';wave.style.left=(event.detail?Math.max(0,Math.min(rect.width,event.clientX-rect.left)):rect.width/2)+'px';wave.style.top=(event.detail?Math.max(0,Math.min(rect.height,event.clientY-rect.top)):rect.height/2)+'px';
 target.append(wave);setTimeout(()=>{wave.remove();if(!target.querySelector(':scope > .tap-ripple'))target.classList.remove('tap-surface')},700);
},{capture:true,passive:true});
