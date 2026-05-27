import { initializeApp } from 'https://www.gstatic.com/firebasejs/11.0.1/firebase-app.js';
import { getAuth } from "https://www.gstatic.com/firebasejs/11.0.1/firebase-auth.js"; // ✅ OK
import { getFirestore } from 'https://www.gstatic.com/firebasejs/11.0.1/firebase-firestore.js';


const cfg = {
  apiKey: 'AIzaSyC_e4oTnRwr1Bpa3ls8HoYFljaR49knnyQ',
  authDomain: 'poissonnerie-gas.firebaseapp.com',
  projectId: 'poissonnerie-gas',
  storageBucket: 'poissonnerie-gas.appspot.com',
  messagingSenderId: '1017257016151',
  appId: '1:1017257016151:web:0693a2c9c8bfa4252d5c12'
};

export const app = initializeApp(cfg);
export const auth = getAuth(app);
export const db = getFirestore(app);