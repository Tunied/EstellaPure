// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import{describe,expect,it}from'vitest';
import{resolveDocumentRef}from'../src/asset/documentRef';
describe('material document texture identities',()=>{
  it('preserves prefixed and bare UUID identities instead of making file paths',()=>{
    const uuid='aaaaaaaa-aaaa-4aaa-8aaa-000000000000';
    for(const ref of [uuid,'@uuid:'+uuid])expect(resolveDocumentRef('assets/mats/m.esmaterial',ref)).toBe(ref);
  });
  it('still resolves document-relative textures and logical project paths',()=>{
    expect(resolveDocumentRef('assets/mats/m.esmaterial','../textures/a.png')).toBe('assets/textures/a.png');
    expect(resolveDocumentRef('assets/mats/m.esmaterial','assets/textures/a.png')).toBe('assets/textures/a.png');
  });
});
