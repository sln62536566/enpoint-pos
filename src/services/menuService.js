// src/services/menuService.js

import { db } from "../firebase/firebase.js";

import {
  ref,
  push,
  set,
  get,
  update,
  remove,
  onValue
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-database.js";


// 🔥 菜單路徑
const MENU_PATH = "menu/items";


// ========================
// 即時監聽菜單
// ========================
export function listenMenus(callback){

  const menuRef = ref(db, MENU_PATH);

  onValue(menuRef, (snapshot) => {

    if(snapshot.exists()){

      callback(snapshot.val());

    }else{

      callback({});

    }

  });

}



// ========================
// 取得全部菜單
// ========================
export async function getAllMenus() {

  try {

    const snapshot = await get(ref(db, MENU_PATH));

    if (snapshot.exists()) {
      return snapshot.val();
    } else {
      return {};
    }

  } catch (error) {

    console.error("取得菜單失敗:", error);

    return {};

  }

}



// ========================
// 新增菜單
// ========================
export async function addMenuItem(menuData) {

  try {

    const newMenuRef = push(ref(db, MENU_PATH));

    await set(newMenuRef, {
      name: menuData.name || "",
      category: menuData.category || "",
      price: Number(menuData.price) || 0,
      enabled: true,
      createdAt: Date.now()
    });

    return {
      success: true
    };

  } catch (error) {

    console.error("新增菜單失敗:", error);

    return {
      success: false,
      error
    };

  }

}



// ========================
// 更新菜單
// ========================
export async function updateMenuItem(menuId, data) {

  try {

    await update(
      ref(db, `${MENU_PATH}/${menuId}`),
      data
    );

    return {
      success: true
    };

  } catch (error) {

    console.error("更新菜單失敗:", error);

    return {
      success: false,
      error
    };

  }

}



// ========================
// 刪除菜單
// ========================
export async function deleteMenuItem(menuId) {

  try {

    await remove(
      ref(db, `${MENU_PATH}/${menuId}`)
    );

    return {
      success: true
    };

  } catch (error) {

    console.error("刪除菜單失敗:", error);

    return {
      success: false,
      error
    };

  }

}



// ========================
// 切換啟用狀態
// ========================
export async function toggleMenuStatus(menuId, currentStatus){

  try {

    await update(
      ref(db, `${MENU_PATH}/${menuId}`),
      {
        enabled: !currentStatus
      }
    );

    return { success: true };

  } catch (error) {

    console.error("切換狀態失敗:", error);

    return { success: false, error };

  }

}