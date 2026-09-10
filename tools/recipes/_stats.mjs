export default async function (api) {
  console.log(JSON.stringify(await api.evaluate(`(() => {
    const S = EL.scene, E = EL.engine;
    S.render();
    return { meshes: S.meshes.length, active: S.getActiveMeshes().length,
             drawCalls: E._drawCalls ? E._drawCalls.current : 'n/a',
             materials: S.materials.length, textures: S.textures.length,
             charMeshes: EL.char.meshes.length,
             emoteKeys: Object.values(window.EMOTES).map(e => e.key).join(' ') };
  })()`), null, 1));
}
