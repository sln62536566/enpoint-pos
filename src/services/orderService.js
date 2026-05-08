// src/services/orderService.js

import { db } from "../firebase/firebase.js";

import {
  ref,
  push,
  set,
  get
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-database.js";


// ========================
// 建立訂單
// ========================
export async function createOrder(orderData){

  try {

    const orderRef = push(ref(db, "orders"));

    await set(orderRef, {

      items: orderData.items || [],

      total: orderData.total || 0,

      status: "pending",

      createdAt: Date.now()

    });

    return {
      success: true,
      orderId: orderRef.key
    };

  } catch (error) {

    console.error("建立訂單失敗:", error);

    return {
      success: false,
      error
    };

  }

}


// ========================
// 取得訂單（之後廚房用）
// ========================
export async function getOrders(){

  try {

    const snapshot = await get(ref(db, "orders"));

    return snapshot.exists() ? snapshot.val() : {};

  } catch (error) {

    console.error("取得訂單失敗:", error);

    return {};

  }

}