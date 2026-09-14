<script setup lang="ts">
import { onBeforeUnmount, ref } from 'vue';
import { adminApi } from '../api';

const emit=defineEmits<{checkedIn:[message:string]}>();
const video=ref<HTMLVideoElement|null>(null);const code=ref('');const active=ref(false);const busy=ref(false);const error=ref('');const success=ref('');
let stream:MediaStream|null=null;let frame=0;

function detector(){const Detector=(window as any).BarcodeDetector;if(!Detector)return null;return new Detector({formats:['qr_code']});}
async function submit(value=code.value){const normalized=String(value||'').trim();if(!normalized||busy.value)return;busy.value=true;error.value='';success.value='';try{const result=await adminApi.redeemCheckInCode(normalized);success.value=`${result.order.customerName||'顾客'} · ${result.order.serviceName||'预约'} 已核销`;emit('checkedIn',success.value);code.value='';stop();}catch(err){error.value=err instanceof Error?err.message:'核销失败';}finally{busy.value=false;}}
async function scanFrame(){if(!active.value||!video.value)return;const scanner=detector();if(!scanner){error.value='当前浏览器不支持实时识别，请用微信扫码后粘贴核销内容。';stop();return;}try{const matches=await scanner.detect(video.value);if(matches[0]?.rawValue){await submit(matches[0].rawValue);return;}}catch{}frame=window.requestAnimationFrame(scanFrame);}
async function start(){error.value='';success.value='';if(!navigator.mediaDevices?.getUserMedia){error.value='当前浏览器无法调用摄像头，请粘贴核销内容。';return;}try{stream=await navigator.mediaDevices.getUserMedia({video:{facingMode:{ideal:'environment'}},audio:false});active.value=true;await new Promise<void>((resolve)=>setTimeout(resolve,50));if(video.value){video.value.srcObject=stream;await video.value.play();frame=window.requestAnimationFrame(scanFrame);}}catch{error.value='无法打开摄像头，请在 Chrome 地址栏允许摄像头权限。';stop();}}
function stop(){active.value=false;if(frame)window.cancelAnimationFrame(frame);frame=0;stream?.getTracks().forEach(track=>track.stop());stream=null;if(video.value)video.value.srcObject=null;}
onBeforeUnmount(stop);
</script>

<template><section class="checkin-scanner"><div class="scanner-copy"><span class="scanner-mark">⌁</span><div><h2>到店核销</h2><p>扫描顾客预约二维码。技师账号只能核销分配给自己的预约，店主和员工可核销全店订单。</p></div></div><div v-if="active" class="scanner-camera"><video ref="video" muted playsinline></video><i></i><button class="soft-button" @click="stop">关闭摄像头</button></div><div class="scanner-actions"><button v-if="!active" class="primary-button" :disabled="busy" @click="start">打开摄像头扫码</button><div class="scanner-manual"><input v-model="code" placeholder="也可粘贴 shiguang:// 核销内容" @keyup.enter="submit()"/><button class="soft-button" :disabled="busy||!code.trim()" @click="submit()">{{busy?'核销中…':'确认核销'}}</button></div></div><p v-if="error" class="field-error">{{error}}</p><p v-if="success" class="inline-success">{{success}}</p></section></template>
