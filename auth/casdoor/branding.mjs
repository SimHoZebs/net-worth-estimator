import { readFileSync } from 'node:fs';

const asset = (name) => readFileSync(new URL(`./branding/${name}`, import.meta.url), 'utf8').trim();
const svgUrl = (svg) => `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`;

// This is the only presentation-field list the migration may write. In particular,
// signinHtml/signupHtml replace Casdoor's forms and must never be set here.
export const brandingFields = Object.freeze([
  'logo', 'logoDark', 'title', 'favicon', 'headerHtml', 'footerHtml',
  'formCss', 'formCssMobile', 'formOffset', 'formSideHtml',
  'formBackgroundUrl', 'formBackgroundUrlMobile', 'themeData',
]);

export function buildBranding() {
  const logo = asset('logo.svg');
  const font = readFileSync(new URL('./branding/manrope-latin-wght-normal.woff2', import.meta.url)).toString('base64');
  const css = asset('form.css');
  return {
    logo: svgUrl(logo),
    logoDark: svgUrl(logo.replaceAll('#007a55', '#5ee9b5').replaceAll('#ecfdf5', '#002c22').replaceAll('#292524', '#f5f5f4')),
    title: 'Waypoint account',
    favicon: svgUrl(asset('mark.svg')),
    headerHtml: `<style>@font-face{font-family:"Manrope Variable";font-style:normal;font-weight:200 800;font-display:swap;src:url(data:font/woff2;base64,${font}) format("woff2")}body,button,input,select,textarea{font-family:"Manrope Variable",sans-serif}</style>`,
    footerHtml: '',
    // v4.23 chooses one stylesheet, rather than adding mobile rules to desktop.
    formCss: css,
    formCssMobile: css,
    formOffset: 4,
    formSideHtml: asset('side.html'),
    formBackgroundUrl: '',
    formBackgroundUrlMobile: '',
    themeData: { isEnabled: true, themeType: 'default', colorPrimary: '#007a55', borderRadius: 6, isCompact: false },
  };
}
