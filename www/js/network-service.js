import { Network } from '@capacitor/network';
import { sincronizar } from './sync-service.js';

Network.addListener('networkStatusChange', status => {

    if(status.connected){
        sincronizar();
    }

});