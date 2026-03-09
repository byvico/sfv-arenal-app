import localforage from "localforage";

export async function guardarOffline(data){

    const id = "inst_" + Date.now();

    await localforage.setItem(id,data);

}