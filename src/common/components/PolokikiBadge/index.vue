<template>
  <span class="polokiki-badge">
    <span class="polokiki-name">gcaxe</span>
  </span>
</template>

<style scoped>
/* 名牌签名：名字色 = 游戏 CharacterName 渐变绿（--color-jade-100/200/300 实测值取自游戏 CSS） */
.polokiki-badge {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  margin-left: 10px;
  vertical-align: middle;
}

.polokiki-name {
  background: linear-gradient(90deg, #82dcca, #82dcca 3%, #d5f3ed 15%, #d5f3ed 30%, #ace7dc 50%, #82dcca 95%, #82dcca);
  -webkit-background-clip: text;
  background-clip: text;
  color: transparent;
  font-weight: 600;
  font-size: 16px;
}
</style>
