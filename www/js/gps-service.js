import { Geolocation } from '@capacitor/geolocation';

export async function obtenerGPS(){

    const position = await Geolocation.getCurrentPosition({
        enableHighAccuracy: true
    });

    return {
        lat: position.coords.latitude,
        lng: position.coords.longitude,
        accuracy: position.coords.accuracy
    };

}