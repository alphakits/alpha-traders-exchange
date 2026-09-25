"use client";
import { useEffect } from "react";
import { usePathname } from "next/navigation";
const VISITOR="alpha_analytics_visitor";const SESSION="alpha_analytics_session";
function id(storage:Storage,key:string){let v=storage.getItem(key);if(!v){v=crypto.randomUUID();storage.setItem(key,v)}return v}
export function TrafficAnalyticsTracker(){const pathname=usePathname();useEffect(()=>{if(!pathname)return;const visitorId=id(localStorage,VISITOR);const sessionId=id(sessionStorage,SESSION);let referrerHost:string|null=null;try{if(document.referrer){const u=new URL(document.referrer);if(u.origin!==location.origin)referrerHost=u.hostname}}catch{}const body={visitorId,sessionId,path:pathname,platform:"web",deviceType:matchMedia("(pointer: coarse)").matches||innerWidth<768?"mobile":"desktop",referrerHost};void fetch("/api/analytics/event",{method:"POST",headers:{"Content-Type":"application/json"},credentials:"include",keepalive:true,body:JSON.stringify(body)}).catch(()=>undefined)},[pathname]);return null}
