<script setup lang="ts">
import {
  IonIcon,
  IonLabel,
  IonPage,
  IonRouterOutlet,
  IonTabBar,
  IonTabButton,
  IonTabs,
} from '@ionic/vue'
import {
  chatbubbleEllipsesOutline,
  compassOutline,
  homeOutline,
  peopleOutline,
  personOutline,
} from 'ionicons/icons'
</script>

<template>
  <ion-page>
    <ion-tabs class="app-tabs">
      <ion-router-outlet />
      <ion-tab-bar class="tab-bar" slot="bottom">
        <ion-tab-button class="tab-button" tab="home" href="/tabs/home">
          <ion-icon :icon="homeOutline" />
          <ion-label>Home</ion-label>
        </ion-tab-button>
        <ion-tab-button class="tab-button" tab="map" href="/tabs/map">
          <ion-icon :icon="compassOutline" />
          <ion-label>Live map</ion-label>
        </ion-tab-button>
        <ion-tab-button class="tab-button" tab="groups" href="/tabs/groups">
          <ion-icon :icon="peopleOutline" />
          <ion-label>Groups</ion-label>
        </ion-tab-button>
        <ion-tab-button class="tab-button" tab="messages" href="/tabs/messages">
          <ion-icon :icon="chatbubbleEllipsesOutline" />
          <ion-label>Messages</ion-label>
        </ion-tab-button>
        <ion-tab-button class="tab-button" tab="profile" href="/tabs/profile">
          <ion-icon :icon="personOutline" />
          <ion-label>Profile</ion-label>
        </ion-tab-button>
      </ion-tab-bar>
    </ion-tabs>
  </ion-page>
</template>
