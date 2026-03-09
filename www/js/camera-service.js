import { Camera } from '@capacitor/camera';

export async function tomarFoto(){

    const photo = await Camera.getPhoto({
        quality: 80,
        resultType: "base64",
        source: "camera"
    });

    return photo.base64String;

}