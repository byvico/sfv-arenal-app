import localforage from "localforage";

export async function sincronizar(){

    const keys = await localforage.keys();

    for(const key of keys){

        const data = await localforage.getItem(key);

        await subirAFirebase(data);

        await localforage.removeItem(key);

    }

}